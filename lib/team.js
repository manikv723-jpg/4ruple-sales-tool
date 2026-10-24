// Team sync for the installed app. Each teammate runs their own copy with their own licence and their own
// Claude Code; this pushes their leads, drafts and the day's activity to the team service and pulls back what
// they are allowed to see. The owner sees everyone; a member sees their own work plus team totals.
// Nothing here sends API keys, Gmail details or deck files.
import { db, save } from './store.js';
import { deviceHash, licenceKey } from './license.js';

const API = process.env.FOURUPLE_TEAM_API
  || (process.env.FOURUPLE_LICENSE_API || 'https://REPLACE-WITH-PROJECT-REF.supabase.co/functions/v1/license').replace(/\/license$/, '/team');
const SKEW = 5 * 60_000; // re-send anything from the last five minutes, in case a clock or a sync was off
const SYNC_EVERY = 60_000;

const inTeam = () => !!db.team?.id;
export const teamRole = () => db.team?.role || null;

// What the app shows: the team, who is on it, their work, and when it last synced.
export function teamState() {
  if (!db.team) return null;
  const t = db.team;
  return {
    id: t.id,
    name: t.name,
    role: t.role,
    memberId: t.memberId,
    members: t.members || [],
    leads: t.leads || [],
    events: t.events || [],
    totals: t.totals || [],
    syncedAt: t.syncedAt || null,
    lastError: t.lastError || null,
    pending: (t.queue?.length || 0) > 0,
  };
}

async function call(action, extra = {}) {
  const key = licenceKey();
  if (!key) return { ok: false, code: 'NO_KEY', error: 'Add your licence key before joining a team. A team needs one licence per person.' };
  let res;
  try {
    res = await fetch(API, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action, key, device: deviceHash(), memberName: db.profile.senderName || '', ...extra }),
      signal: AbortSignal.timeout(20_000),
    });
  } catch {
    return { ok: false, offline: true, code: 'OFFLINE', error: "Couldn't reach the team service. Your work is saved here and will sync when you're back online." };
  }
  if (res.status >= 500) return { ok: false, offline: true, code: 'OFFLINE', error: 'The team service is having trouble. Your work is saved here.' };
  try { return await res.json(); } catch { return { ok: false, offline: true, code: 'OFFLINE', error: `The team service sent an unexpected answer (${res.status}).` }; }
}

// ---------- what this laptop sends ----------
const timeOf = (...values) => Math.max(0, ...values.map((v) => Number(v) || 0));

function leadStatus(lead) {
  const o = lead.outreach || {};
  if (o.status === 'replied') return o.temperature === 'hot' ? 'interested' : 'not interested';
  if (o.status === 'bounced') return 'bounced';
  if (o.email1) return 'sent';
  if (o.queued) return 'queued';
  if (lead.approved) return 'approved';
  if (['queued', 'running'].includes(lead.gen?.status)) return 'writing';
  if (lead.gen?.subject) return 'to review';
  return 'new';
}

// The last moment anything happened to this person, so only what changed gets pushed.
function leadTouched(lead) {
  const o = lead.outreach || {};
  return timeOf(lead.createdAt, lead.gen?.generatedAt, lead.gen?.startedAt, lead.approvedAt, o.queued?.at,
    o.email1?.sentAt, o.followup1?.sentAt, o.followup2?.sentAt, o.repliedAt, o.bouncedAt);
}

function leadFor(lead) {
  const g = lead.gen || {};
  return {
    ref: lead.id,
    email: lead.email,
    fullName: lead.fullName,
    title: lead.title,
    company: lead.company,
    domain: lead.domain,
    linkedin: lead.linkedin,
    location: lead.location,
    status: leadStatus(lead),
    draft: g.subject
      ? {
          subject: g.subject,
          email1: g.email1,
          followup1: g.followup1,
          followup2: g.followup2,
          hookTier: g.hook_tier || g.hook?.tier || '',
          hookScore: g.personalization_score || g.hook?.score || null,
          deck: !!g.deckPath,
          why: g.hookSource || '',
        }
      : null,
    updatedAt: leadTouched(lead) || Date.now(),
  };
}

// The day's work, read straight off each lead, so nothing has to be recorded as it happens.
// Each event has a fixed name, so a repeated sync never counts the same thing twice.
function eventsFor(lead) {
  const out = [];
  const add = (name, type, at, note) => {
    if (at) out.push({ ref: `${lead.id}:${name}`, type, at, leadEmail: lead.email, leadName: lead.fullName, company: lead.company, note });
  };
  const o = lead.outreach || {};
  add('added', 'lead_added', lead.createdAt);
  add('draft', 'draft_written', lead.gen?.generatedAt);
  add('approved', 'approved', lead.approvedAt);
  if (o.email1 && !o.email1.test) add('email1', 'email_sent', o.email1.sentAt);
  if (o.followup1) add('followup1', 'followup_sent', o.followup1.sentAt);
  if (o.followup2) add('followup2', 'followup_sent', o.followup2.sentAt);
  if (o.status === 'replied') add('reply', o.temperature === 'hot' ? 'reply_hot' : 'reply_cold', o.repliedAt, o.replySummary);
  if (o.status === 'bounced') add('bounce', 'bounced', o.bouncedAt);
  return out;
}

// ---------- joining ----------
function remember(r, extra = {}) {
  db.team = {
    ...(db.team || {}),
    id: r.team.id,
    name: r.team.name,
    role: r.me.role,
    memberId: r.me.id,
    members: r.members || db.team?.members || [],
    ...extra,
  };
  save();
  return teamState();
}

export async function createTeam(name) {
  if (inTeam()) return { ok: false, code: 'ALREADY_IN_TEAM', error: 'This laptop is already on a team.' };
  const r = await call('create', { teamName: name });
  if (!r.ok) return r;
  remember(r, { leads: [], events: [], totals: [], syncedAt: null });
  return { ok: true, team: teamState() };
}

export async function joinTeam(code, name) {
  if (inTeam()) return { ok: false, code: 'ALREADY_IN_TEAM', error: 'This laptop is already on a team.' };
  const r = await call('join', { code, memberName: name || db.profile.senderName || '' });
  if (!r.ok) return r;
  remember(r, { leads: [], events: [], totals: [], syncedAt: null });
  return { ok: true, team: teamState() };
}

export async function inviteToTeam() {
  const r = await call('invite');
  return r.ok ? { ok: true, code: r.code, expiresAt: r.expiresAt } : r;
}

export async function renameTeam(name) {
  const r = await call('rename', { teamName: name });
  if (r.ok) { db.team.name = r.team.name; save(); }
  return r;
}

export async function removeTeamMember(memberId) {
  const r = await call('remove', { memberId });
  if (r.ok) { db.team.members = r.members; save(); }
  return r;
}

export async function leaveTeam() {
  const r = await call('leave');
  // A team that no longer knows this licence is gone from here either way.
  if (r.ok || ['NO_TEAM', 'INVALID_KEY'].includes(r.code)) { db.team = null; save(); return { ok: true }; }
  return r;
}

// ---------- sync ----------
let syncing = null;

export function syncTeam(options = {}) {
  if (!inTeam()) return Promise.resolve({ ok: false, code: 'NO_TEAM' });
  syncing ||= runSync(options).finally(() => { syncing = null; });
  return syncing;
}

async function runSync({ force = false } = {}) {
  const t = db.team;
  const now = Date.now();
  if (!force && t.syncedAt && now - Date.parse(t.syncedAt) < SYNC_EVERY) return { ok: true, skipped: true };

  const since = t.pushedThrough ? t.pushedThrough - SKEW : 0;
  const changed = db.leads.filter((l) => leadTouched(l) >= since);
  const events = changed.flatMap(eventsFor).filter((e) => e.at >= since);
  const blocked = (db.blocked || []).filter((b) => !b.fromTeam && (b.at || 0) >= since)
    .map((b) => ({ value: b.value, reason: b.reason, at: b.at }));

  const r = await call('sync', {
    since: t.syncedAt || undefined,
    leads: changed.slice(0, 500).map(leadFor),
    events: events.slice(0, 500),
    blocked: blocked.slice(0, 500),
  });
  if (!r.ok) {
    db.team.lastError = r.error;
    save();
    return r;
  }

  // Someone else on the team already owns these people, so this laptop must not email them.
  const rejected = r.rejected || [];
  for (const row of rejected) {
    const lead = db.leads.find((l) => l.id === row.ref);
    if (lead) lead.teamOwner = row.ownerId;
  }
  for (const lead of db.leads) if (!rejected.some((row) => row.ref === lead.id)) delete lead.teamOwner;

  // The team's do-not-contact list is everyone's.
  for (const entry of r.blocked || []) {
    if (!db.blocked.some((b) => b.value === entry.value)) {
      db.blocked.push({ value: entry.value, reason: entry.reason, at: Date.parse(entry.at) || now, fromTeam: true });
    }
  }

  const keep = (list, incoming, by) => {
    const merged = new Map((list || []).map((row) => [row[by], row]));
    for (const row of incoming || []) merged.set(row[by], row);
    return [...merged.values()];
  };

  db.team = {
    ...t,
    name: r.team.name,
    role: r.role,
    memberId: r.me.id,
    members: r.members,
    leads: keep(t.leads, r.leads, 'ref'),
    events: keep(t.events, r.events, 'ref').sort((a, b) => Date.parse(b.at) - Date.parse(a.at)).slice(0, 400),
    totals: r.totals,
    syncedAt: r.now,
    pushedThrough: now,
    lastError: null,
  };
  save();
  return { ok: true, leads: r.leads.length, events: r.events.length, rejected: rejected.length };
}

// Used when adding people: someone a teammate already owns is skipped instead of emailed twice.
export function heldByTeammate(email) {
  const t = db.team;
  if (!t?.id) return null;
  const row = (t.leads || []).find((l) => l.email === String(email || '').toLowerCase());
  return row && row.ownerId !== t.memberId ? row : null;
}

export const teamMemberName = (memberId) => (db.team?.members || []).find((m) => m.id === memberId)?.name || 'a teammate';
