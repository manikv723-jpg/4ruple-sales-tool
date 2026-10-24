// Team rules for 4ruple.ai, shared by the Supabase `team` edge function and the app's tests.
// Only Web Crypto and plain objects, so this one file runs in Deno and Node. A copy lives in
// supabase/functions/_shared/team-core.js; the tests fail if the two drift apart.
//
// How a team works:
//   Every teammate buys their own licence and keeps using their own Claude Code. One licence is one seat.
//   The owner creates the team and invites with a code. Everyone's leads, drafts and activity are pushed to
//   the team so the owner can see the day's work, and so two people never email the same person.
//   The owner sees every teammate's leads, drafts and feed. A member sees their own work plus team totals.
import { normalizeKey, keyHash, sha256Hex } from './license-core.js';

export const INVITE_DAYS = 7;
export const FEED_DAYS = 14;
const DAY = 86_400_000;
const CODE_ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ'; // Crockford base32, same as licence keys

const fail = (status, code, error, extra = {}) => ({ status, json: { ok: false, code, error, ...extra } });
const clean = (value, max) => String(value ?? '').trim().slice(0, max);
const lower = (value) => clean(value, 200).toLowerCase();

// ---------- invite codes ----------
export function newTeamCode() {
  const body = [...crypto.getRandomValues(new Uint8Array(8))].map((b) => CODE_ALPHABET[b & 31]).join('');
  return `4T-${body.slice(0, 4)}-${body.slice(4)}`;
}

export function normalizeTeamCode(input) {
  let s = String(input ?? '').toUpperCase().replace(/[^0-9A-Z]/g, '').replace(/O/g, '0').replace(/[IL]/g, '1');
  if (s.length === 10 && s.startsWith('4T')) s = s.slice(2);
  if (s.length !== 8 || [...s].some((c) => !CODE_ALPHABET.includes(c))) return null;
  return `4T-${s.slice(0, 4)}-${s.slice(4)}`;
}

export const codeHash = (code) => sha256Hex(`4ruple-team-invite:${code}`);
const emailKey = (email) => lower(email);

// ---------- what each side sends ----------
// A lead as it travels: enough for the owner to see the pipeline and read the draft, never API keys or Gmail details.
export function leadPayload(lead) {
  return {
    ref: clean(lead.ref, 64),
    email: emailKey(lead.email),
    fullName: clean(lead.fullName, 120),
    title: clean(lead.title, 160),
    company: clean(lead.company, 160),
    domain: clean(lead.domain, 160),
    linkedin: clean(lead.linkedin, 300),
    location: clean(lead.location, 160),
    status: clean(lead.status, 24),
    draft: lead.draft
      ? {
          subject: clean(lead.draft.subject, 300),
          email1: clean(lead.draft.email1, 8000),
          followup1: clean(lead.draft.followup1, 8000),
          followup2: clean(lead.draft.followup2, 8000),
          hookTier: clean(lead.draft.hookTier, 24),
          hookScore: Number(lead.draft.hookScore) || null,
          deck: !!lead.draft.deck,
          why: clean(lead.draft.why, 1000),
        }
      : null,
    updatedAt: Number(lead.updatedAt) || Date.now(),
  };
}

export const EVENT_TYPES = [
  'lead_added', 'draft_written', 'draft_changed', 'approved',
  'email_sent', 'followup_sent', 'reply_hot', 'reply_cold', 'bounced', 'blocked',
];

export function eventPayload(event) {
  return {
    ref: clean(event.ref, 64),
    type: EVENT_TYPES.includes(event.type) ? event.type : null,
    at: Number(event.at) || Date.now(),
    leadEmail: emailKey(event.leadEmail),
    leadName: clean(event.leadName, 120),
    company: clean(event.company, 160),
    note: clean(event.note, 300),
  };
}

const memberView = (m) => ({
  id: m.id,
  name: m.display_name,
  role: m.role,
  joinedAt: m.joined_at,
  lastSeenAt: m.last_seen_at,
  removed: !!m.removed_at,
});

const leadView = (row, { drafts }) => ({
  ref: row.lead_ref,
  ownerId: row.owner_member_id,
  email: row.email,
  ...row.data,
  draft: drafts ? row.data?.draft ?? null : undefined,
  updatedAt: row.updated_at,
});

// Counts per teammate per day, which is what a member is allowed to see of everyone else.
export function totalsFrom(events) {
  const byMember = new Map();
  for (const e of events) {
    const day = new Date(e.at).toISOString().slice(0, 10);
    const key = `${e.member_id}:${day}`;
    const row = byMember.get(key) || { memberId: e.member_id, day, leads: 0, drafts: 0, approved: 0, sent: 0, replies: 0, bounced: 0 };
    if (e.type === 'lead_added') row.leads += 1;
    else if (e.type === 'draft_written') row.drafts += 1;
    else if (e.type === 'approved') row.approved += 1;
    else if (e.type === 'email_sent' || e.type === 'followup_sent') row.sent += 1;
    else if (e.type === 'reply_hot' || e.type === 'reply_cold') row.replies += 1;
    else if (e.type === 'bounced') row.bounced += 1;
    byMember.set(key, row);
  }
  return [...byMember.values()].sort((a, b) => (a.day < b.day ? 1 : -1));
}

/**
 * Handles one team request from the app.
 * store: findLicense(keyHash), findMemberByLicense(licenseId), findMember(id), team(teamId), members(teamId),
 *        createTeam(row), addMember(row), updateMember(id, patch),
 *        createInvite(row), findInvite(codeHash), useInvite(id, memberId),
 *        upsertLeads(teamId, rows), leadsByEmails(teamId, emails), leadsSince(teamId, sinceIso, ownerMemberId),
 *        insertEvents(rows), eventsSince(teamId, sinceIso, memberId), eventsForTotals(teamId, sinceIso),
 *        upsertBlocked(teamId, rows), blockedSince(teamId, sinceIso)
 */
export async function handleTeamRequest(body, { store, now = Date.now() }) {
  const action = body?.action;
  const ACTIONS = ['status', 'create', 'invite', 'join', 'leave', 'remove', 'rename', 'sync'];
  if (!ACTIONS.includes(action)) return fail(400, 'BAD_REQUEST', 'Unknown action');

  const key = normalizeKey(body.key);
  if (!key) return fail(400, 'INVALID_KEY', "That licence key isn't right. Copy it again from your purchase email.");
  const device = String(body.device || '');
  if (!/^[a-f0-9]{64}$/.test(device)) return fail(400, 'BAD_REQUEST', 'Missing device id');

  const licence = await store.findLicense(await keyHash(key));
  if (!licence) return fail(404, 'INVALID_KEY', "That licence key isn't right. Copy it again from your purchase email.");
  if (licence.status !== 'active') return fail(403, 'REVOKED', 'This licence is no longer active, so it can\'t be on a team.');

  const member = await store.findMemberByLicense(licence.id);
  const active = member && !member.removed_at ? member : null;
  const displayName = clean(body.memberName, 80) || licence.email.split('@')[0];

  // ---------- joining and leaving ----------
  if (action === 'create') {
    if (active) return fail(409, 'ALREADY_IN_TEAM', 'This licence is already on a team. Leave that team first.');
    const team = await store.createTeam({ name: clean(body.teamName, 80) || `${displayName}'s team`, owner_license_id: licence.id });
    const owner = await store.addMember({ team_id: team.id, licence_id: licence.id, display_name: displayName, role: 'owner' });
    return { status: 200, json: { ok: true, team: { id: team.id, name: team.name }, me: memberView(owner), members: [memberView(owner)] } };
  }

  if (action === 'join') {
    if (active) return fail(409, 'ALREADY_IN_TEAM', 'This licence is already on a team. Leave that team first.');
    const code = normalizeTeamCode(body.code);
    if (!code) return fail(400, 'INVALID_CODE', "That isn't a team code. It looks like 4T-XXXX-XXXX.");
    const invite = await store.findInvite(await codeHash(code));
    if (!invite) return fail(404, 'INVALID_CODE', "That team code doesn't exist. Ask your team owner for a new one.");
    if (invite.used_at) return fail(409, 'CODE_USED', 'That team code has already been used. Ask for a new one.');
    if (Date.parse(invite.expires_at) < now) return fail(410, 'CODE_EXPIRED', 'That team code has expired. Ask for a new one.');
    const joined = await store.addMember({ team_id: invite.team_id, licence_id: licence.id, display_name: displayName, role: 'member' });
    await store.useInvite(invite.id, joined.id);
    const team = await store.team(invite.team_id);
    return { status: 200, json: { ok: true, team: { id: team.id, name: team.name }, me: memberView(joined), members: (await store.members(team.id)).map(memberView) } };
  }

  if (!active) return fail(404, 'NO_TEAM', 'This licence is not on a team yet.');
  const team = await store.team(active.team_id);
  const isOwner = active.role === 'owner';
  await store.updateMember(active.id, { last_seen_at: new Date(now).toISOString() });

  if (action === 'status') {
    return { status: 200, json: { ok: true, team: { id: team.id, name: team.name }, me: memberView(active), members: (await store.members(team.id)).map(memberView) } };
  }

  if (action === 'invite') {
    if (!isOwner) return fail(403, 'OWNER_ONLY', 'Only the team owner can invite people.');
    const code = newTeamCode();
    const invite = await store.createInvite({
      team_id: team.id,
      code_hash: await codeHash(code),
      created_by: active.id,
      expires_at: new Date(now + INVITE_DAYS * DAY).toISOString(),
    });
    return { status: 200, json: { ok: true, code, expiresAt: invite.expires_at } };
  }

  if (action === 'rename') {
    if (!isOwner) return fail(403, 'OWNER_ONLY', 'Only the team owner can rename the team.');
    const name = clean(body.teamName, 80);
    if (!name) return fail(400, 'BAD_REQUEST', 'Give the team a name.');
    await store.renameTeam(team.id, name);
    return { status: 200, json: { ok: true, team: { id: team.id, name } } };
  }

  if (action === 'leave') {
    if (isOwner) return fail(409, 'OWNER_CANNOT_LEAVE', 'You own this team, so you can\'t leave it. Remove the other people first.');
    await store.updateMember(active.id, { removed_at: new Date(now).toISOString() });
    return { status: 200, json: { ok: true, left: true } };
  }

  if (action === 'remove') {
    if (!isOwner) return fail(403, 'OWNER_ONLY', 'Only the team owner can remove people.');
    const target = await store.findMember(String(body.memberId || ''));
    if (!target || target.team_id !== team.id || target.removed_at) return fail(404, 'NO_MEMBER', 'That person is not on your team.');
    if (target.id === active.id) return fail(409, 'OWNER_CANNOT_LEAVE', 'You can\'t remove yourself.');
    await store.updateMember(target.id, { removed_at: new Date(now).toISOString() });
    return { status: 200, json: { ok: true, members: (await store.members(team.id)).map(memberView) } };
  }

  // ---------- sync ----------
  if (action === 'sync') {
    const nowIso = new Date(now).toISOString();
    const leads = [].concat(body.leads || []).slice(0, 500).map(leadPayload).filter((l) => l.ref && l.email);
    const events = [].concat(body.events || []).slice(0, 500).map(eventPayload).filter((e) => e.ref && e.type);
    const blocked = [].concat(body.blocked || []).slice(0, 500)
      .map((b) => ({ value: lower(b.value), reason: clean(b.reason, 24), at: Number(b.at) || now }))
      .filter((b) => b.value);

    // Someone else's person stays theirs: the app is told so it can skip them instead of emailing twice.
    const existing = leads.length ? await store.leadsByEmails(team.id, leads.map((l) => l.email)) : [];
    const owners = new Map(existing.map((row) => [row.email, row]));
    const mine = [];
    const rejected = [];
    for (const lead of leads) {
      const held = owners.get(lead.email);
      if (held && held.owner_member_id !== active.id) {
        rejected.push({ ref: lead.ref, email: lead.email, reason: 'owned', ownerId: held.owner_member_id });
        continue;
      }
      mine.push({
        team_id: team.id,
        lead_ref: lead.ref,
        owner_member_id: active.id,
        email: lead.email,
        data: lead,
        updated_at: new Date(lead.updatedAt).toISOString(),
      });
    }
    if (mine.length) await store.upsertLeads(team.id, mine);
    if (events.length) {
      await store.insertEvents(events.map((e) => ({
        team_id: team.id,
        member_id: active.id,
        event_ref: e.ref,
        type: e.type,
        at: new Date(e.at).toISOString(),
        lead_email: e.leadEmail || null,
        meta: { leadName: e.leadName, company: e.company, note: e.note },
      })));
    }
    if (blocked.length) {
      await store.upsertBlocked(team.id, blocked.map((b) => ({
        team_id: team.id, value: b.value, reason: b.reason, by_member_id: active.id, at: new Date(b.at).toISOString(),
      })));
    }

    // Pull. The owner gets everyone's leads, drafts and feed; a member gets their own plus team totals.
    const since = body.since && !Number.isNaN(Date.parse(body.since)) ? body.since : new Date(0).toISOString();
    const feedSince = new Date(now - FEED_DAYS * DAY).toISOString();
    const [leadRows, eventRows, blockedRows, memberRows, totalsRows] = await Promise.all([
      store.leadsSince(team.id, since, isOwner ? null : active.id),
      store.eventsSince(team.id, since > feedSince ? since : feedSince, isOwner ? null : active.id),
      store.blockedSince(team.id, since),
      store.members(team.id),
      store.eventsForTotals(team.id, feedSince),
    ]);

    return {
      status: 200,
      json: {
        ok: true,
        now: nowIso,
        team: { id: team.id, name: team.name },
        me: memberView(active),
        role: active.role,
        members: memberRows.map(memberView),
        leads: leadRows.map((row) => leadView(row, { drafts: isOwner || row.owner_member_id === active.id })),
        events: eventRows.map((e) => ({
          ref: e.event_ref, memberId: e.member_id, type: e.type, at: e.at,
          leadEmail: e.lead_email, leadName: e.meta?.leadName, company: e.meta?.company, note: e.meta?.note,
        })),
        blocked: blockedRows.map((b) => ({ value: b.value, reason: b.reason, at: b.at, byMemberId: b.by_member_id })),
        totals: totalsFrom(totalsRows),
        rejected,
      },
    };
  }

  return fail(400, 'BAD_REQUEST', 'Unknown action');
}
