import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { db, secrets, save, saveSecrets, newId, DATA_DIR } from './lib/store.js';
import { prospeoFind, apolloFind, hunterFind, parseLeadsCsv, cleanDomain, DEPARTMENTS, SENIORITY } from './lib/leads.js';
import { generateLead, reviseLead, autoReadPortfolio } from './lib/generate.js';
import { sendStep, verifyInbox, tick, nextDue, inboxReady, appPasswordLooksRight, APP_PASSWORD_HELP } from './lib/outreach.js';
import { block, unblock, entryValue, isFreeMailDomain, isBlocked, REASONS } from './lib/blocklist.js';
import { inWindow, nextWindow, sentToday, dailyCap, validTimezone, timezoneOf, toMinutes, fromMinutes } from './lib/schedule.js';
import { licenseStatus, activateLicense, removeDevice, deactivateThisDevice } from './lib/license.js';
import { teamState, createTeam, joinTeam, inviteToTeam, renameTeam, removeTeamMember, leaveTeam, syncTeam, heldByTeammate, teamMemberName } from './lib/team.js';

const PORT = Number(process.env.PORT || 4600);
const HOST = process.env.HOST || '127.0.0.1';
const PUBLIC_DIR = path.join(import.meta.dirname, 'public');
const PROFILE_KEYS = ['senderName', 'senderTitle', 'companyName', 'website', 'portfolioLinks', 'brandWork', 'notableClients', 'about', 'icp', 'departments', 'seniority', 'whatYouSolve', 'calendly'];
const SECRET_KEYS = ['apolloKey', 'prospeoKey', 'hunterKey', 'inboxEmail', 'appPassword'];
const FREE_MAIL = new Set(['gmail.com', 'googlemail.com', 'yahoo.com', 'outlook.com', 'hotmail.com', 'icloud.com', 'proton.me', 'rediffmail.com']);

class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}
const bad = (msg) => new HttpError(400, msg);

// Jobs don't survive a restart, so don't leave leads stuck on "running".
for (const l of db.leads) {
  if (['queued', 'running'].includes(l.gen?.status)) {
    l.gen.status = 'error';
    l.gen.error = 'Interrupted by a restart. Click Generate again.';
  }
}
save();

// ---------- generation queue ----------
const queue = [];
let running = 0;
const CONCURRENCY = Number(process.env.GEN_CONCURRENCY || 2);

function enqueue(lead, job) {
  if (['queued', 'running'].includes(lead.gen?.status)) throw bad('This lead is already being generated');
  lead.gen = { ...(lead.gen || {}), status: 'queued', error: null };
  queue.push({ id: lead.id, job });
  save();
  pump();
}

function pump() {
  while (running < CONCURRENCY && queue.length) {
    const { id, job } = queue.shift();
    const lead = db.leads.find((l) => l.id === id);
    if (!lead) continue;
    running++;
    lead.gen.status = 'running';
    lead.gen.startedAt = Date.now();
    save();
    job(lead)
      .then((result) => { Object.assign(lead.gen, result, { status: 'done', error: null }); })
      .catch((e) => {
        console.error(`[generate] ${lead.email}:`, e.message);
        lead.gen.status = lead.gen.subject ? 'done' : 'error';
        lead.gen.error = String(e.message || e).slice(0, 500);
      })
      .finally(() => { running--; save(); pump(); });
  }
}

// ---------- helpers ----------
const ctx = () => ({ db, secrets, profile: db.profile, settings: db.settings });
const perCompanyLimit = () => Math.min(Math.max(Math.round(Number(db.settings.perCompany)) || 4, 1), 25);

// Live emails are queued, then worked through inside sending hours, one a minute.
async function startSending(queued) {
  const r = await tick(ctx());
  save();
  const s = db.settings;
  return {
    queued,
    sentNow: r.sent || 0,
    errors: r.errors || [],
    next: inWindow(s) ? null : nextWindow(s),
    capReached: sentToday(db.leads, s) >= dailyCap(s),
  };
}

// Team calls answer { ok, ... }; a refusal carries a message written for the customer.
async function teamAnswer(promise) {
  const r = await promise;
  if (!r.ok) throw bad(r.error || "That didn't work. Try again in a moment.");
  save();
  return { result: r };
}

function mustLead(id) {
  const lead = db.leads.find((l) => l.id === id);
  if (!lead) throw new HttpError(404, 'Lead not found');
  return lead;
}

// Adds found people, skipping anyone already listed, on the do-not-contact list, or over the per-company limit.
function addLeads(list, source) {
  const seen = new Set(db.leads.map((l) => l.email.toLowerCase()));
  const cap = perCompanyLimit();
  const companyKey = (domain, company) => String(domain || company || '').trim().toLowerCase();
  const atCompany = new Map();
  for (const l of db.leads) {
    const k = companyKey(l.domain, l.company);
    if (k) atCompany.set(k, (atCompany.get(k) || 0) + 1);
  }
  const skipped = { duplicate: 0, blocked: 0, overLimit: 0, teammate: 0 };
  let added = 0;
  for (const raw of list) {
    const email = String(raw.email || '').trim();
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) continue;
    if (seen.has(email.toLowerCase())) { skipped.duplicate++; continue; }
    if (isBlocked(db, email)) { skipped.blocked++; continue; }
    // A teammate already owns this person, so they don't get a second email from this laptop.
    if (heldByTeammate(email)) { skipped.teammate++; continue; }
    const parts = String(raw.fullName || '').trim().split(/\s+/);
    const firstName = raw.firstName || parts[0] || '';
    const lastName = raw.lastName || parts.slice(1).join(' ') || '';
    const emailDomain = email.split('@')[1].toLowerCase();
    const domain = raw.domain || (raw.website ? cleanDomain(raw.website) : FREE_MAIL.has(emailDomain) ? '' : emailDomain);
    const key = companyKey(domain, raw.company);
    if (key && (atCompany.get(key) || 0) >= cap) { skipped.overLimit++; continue; }
    seen.add(email.toLowerCase());
    if (key) atCompany.set(key, (atCompany.get(key) || 0) + 1);
    db.leads.push({
      id: newId(),
      source,
      firstName,
      lastName,
      fullName: `${firstName} ${lastName}`.trim(),
      title: raw.title || '',
      department: raw.department || '',
      company: raw.company || domain,
      domain,
      website: raw.website || (domain ? `https://${domain}` : ''),
      logo: raw.logo || '',
      linkedin: raw.linkedin || '',
      location: raw.location || '',
      email,
      emailStatus: raw.emailStatus || '',
      createdAt: Date.now(),
      gen: { status: 'idle' },
      comments: [],
      approved: false,
      outreach: {},
    });
    added++;
  }
  save();
  return { added, skipped };
}

// "Dunkin Donuts" and "Dunkin'" are one client: names match on letters only, or on a shared first word.
function mergeClients(typed, found) {
  const seen = new Set();
  const firstWords = new Set();
  return [...String(typed || '').split(','), ...(found || [])]
    .map((n) => n.trim())
    .filter((n) => {
      const key = n.toLowerCase().replace(/[^a-z0-9]/g, '');
      const first = n.toLowerCase().split(/\s+/)[0].replace(/[^a-z0-9]/g, '');
      if (!key || seen.has(key) || (first.length >= 5 && firstWords.has(first))) return false;
      seen.add(key);
      if (first.length >= 5) firstWords.add(first);
      return true;
    })
    .join(', ');
}

function publicState() {
  const s = db.settings;
  const now = Date.now();
  const open = inWindow(s, now);
  const windowAt = open ? now : nextWindow(s, now);
  return {
    profile: db.profile,
    settings: { ...s, timezone: timezoneOf(s) },
    leads: db.leads.map((l) => {
      const due = nextDue(l, s);
      // Real emails wait for sending hours, so show when they'll actually go out.
      const at = !due || due.test ? due?.at : due.at <= now ? windowAt : nextWindow(s, due.at);
      return { ...l, nextDue: due && { ...due, at: at ?? due.at } };
    }),
    blocked: [...db.blocked].sort((a, b) => b.at - a.at).map((b) => ({ ...b, label: REASONS[b.reason] || b.reason })),
    sending: { open, next: windowAt, sentToday: sentToday(db.leads, s, now), cap: dailyCap(s) },
    team: teamState(),
    connections: {
      apollo: !!secrets.apolloKey,
      prospeo: !!secrets.prospeoKey,
      hunter: !!secrets.hunterKey,
      inbox: inboxReady(secrets),
      inboxEmail: secrets.inboxEmail || '',
    },
    options: { departments: DEPARTMENTS, seniority: SENIORITY },
    queue: { running, waiting: queue.length },
  };
}

// ---------- routes ----------
const routes = [
  ['GET', /^\/api\/state$/, () => publicState()],

  ['POST', /^\/api\/profile$/, (b) => {
    for (const k of PROFILE_KEYS) if (k in b) db.profile[k] = Array.isArray(db.profile[k]) ? [].concat(b[k] || []) : String(b[k] ?? '');
    save();
  }],

  ['POST', /^\/api\/profile\/autoread$/, async () => {
    const p = db.profile;
    if (!p.portfolioLinks && !p.brandWork && !p.website) throw bad('Add portfolio links or describe your work first');
    const r = await autoReadPortfolio(p);
    if (!r.whatYouSolve.length && !r.proof.length) {
      const why = r.sources.filter((s) => !s.ok).map((s) => s.error).join(' ');
      throw bad(`Couldn't find your work in those links. ${why}`.trim());
    }
    Object.assign(p, {
      whatYouSolve: r.whatYouSolve.join('\n'),
      firmSummary: r.firmSummary,
      services: r.services,
      industries: r.industries,
      proof: r.proof,
      portfolioGaps: r.gaps,
      portfolioSources: r.sources,
      portfolioReadAt: Date.now(),
    });
    // The clients they typed stay first; the portfolio only adds names that aren't there yet.
    p.notableClients = mergeClients(p.notableClients, r.notableClients);
    save();
    return {
      result: {
        proof: r.proof.length,
        read: r.sources.filter((s) => s.ok).map((s) => ({ kind: s.kind, count: s.count, title: s.title })),
        unread: r.sources.filter((s) => !s.ok).map((s) => `${s.url}: ${s.error}`),
        gaps: r.gaps,
      },
    };
  }],

  ['POST', /^\/api\/settings$/, (b) => {
    const s = db.settings;
    // Check everything first, so a bad value never leaves settings half-saved.
    const from = toMinutes('sendFrom' in b ? b.sendFrom : s.sendFrom);
    const to = toMinutes('sendTo' in b ? b.sendTo : s.sendTo);
    if (from === null || to === null) throw bad('Use sending times like 09:00 and 18:00');
    if (from === to) throw bad('Sending hours need different start and end times');
    if ('timezone' in b && !validTimezone(b.timezone)) throw bad(`"${b.timezone}" isn't a time zone. Pick one from the list, like Asia/Kolkata.`);

    let cancelled = 0;
    if ('testMode' in b) {
      const goingLive = s.testMode && !b.testMode;
      const goingPreview = !s.testMode && !!b.testMode;
      s.testMode = !!b.testMode;
      // Preview emails only reached your own inbox, so going live puts those people back at "not sent"
      // and their real sequence starts with the first email, not a follow-up.
      if (goingLive) for (const l of db.leads) if (l.outreach?.email1?.test) l.outreach = { previewedAt: l.outreach.email1.sentAt };
      // Turning preview back on means "stop": real emails still waiting for sending hours don't go out.
      if (goingPreview) for (const l of db.leads) if (l.outreach?.queued) { delete l.outreach.queued; cancelled++; }
    }
    for (const k of ['gap1', 'gap2']) if (k in b) s[k] = Math.min(Math.max(Number(b[k]) || 0, 0), 60);
    if (['days', 'minutes'].includes(b.gapUnit)) s.gapUnit = b.gapUnit;
    s.sendFrom = fromMinutes(from);
    s.sendTo = fromMinutes(to);
    if ('weekends' in b) s.weekends = !!b.weekends;
    if ('dailyCap' in b) s.dailyCap = dailyCap({ dailyCap: b.dailyCap });
    if ('timezone' in b) s.timezone = b.timezone;
    if ('perCompany' in b) s.perCompany = Math.min(Math.max(Math.round(Number(b.perCompany)) || 4, 1), 25);
    if (['auto', 'apollo', 'prospeo', 'hunter'].includes(b.leadSource)) s.leadSource = b.leadSource;
    save();
    return { result: { cancelled } };
  }],

  ['POST', /^\/api\/secrets$/, async (b) => {
    const pass = typeof b.appPassword === 'string' ? b.appPassword.trim() : '';
    if (pass && !appPasswordLooksRight(pass)) throw bad(`That isn't a Gmail app password. ${APP_PASSWORD_HELP}`);
    for (const k of SECRET_KEYS) if (typeof b[k] === 'string' && b[k].trim()) secrets[k] = b[k].trim();
    for (const k of [].concat(b.clear || [])) if (SECRET_KEYS.includes(k)) delete secrets[k];
    saveSecrets();
    // Check Gmail the moment its details change, so a wrong password shows up here, not at send time.
    const gmailChanged = pass || (typeof b.inboxEmail === 'string' && b.inboxEmail.trim());
    if (gmailChanged && secrets.inboxEmail && secrets.appPassword) {
      try {
        await verifyInbox(secrets);
      } catch (e) {
        if (e.auth) { delete secrets.appPassword; saveSecrets(); }
        throw bad(e.message);
      }
      return { result: 'Gmail connected. Sending and reply tracking will work.' };
    }
  }],

  ['POST', /^\/api\/secrets\/test-inbox$/, async () => {
    try { await verifyInbox(secrets); } catch (e) { throw bad(`Inbox connection failed: ${e.message}`); }
    return { result: 'Inbox connected. Sending and reply tracking will work.' };
  }],

  // One search box for customers. The chosen source runs first; the next connected one only runs if it found nobody.
  ['POST', /^\/api\/leads\/find$/, async (b) => {
    if (!String(b.companies || '').trim()) throw bad('Add at least one company');
    const p = db.profile;
    const opts = { companies: b.companies, departments: p.departments, seniority: p.seniority, perCompany: perCompanyLimit(), max: 20 };
    const sources = {
      prospeo: secrets.prospeoKey && { label: 'Prospeo', run: () => prospeoFind(opts, secrets.prospeoKey) },
      apollo: secrets.apolloKey && { label: 'Apollo', run: () => apolloFind(opts, secrets.apolloKey) },
      hunter: secrets.hunterKey && { label: 'Hunter', run: () => hunterFind(opts, secrets.hunterKey) },
    };
    const order = [db.settings.leadSource, 'prospeo', 'apollo', 'hunter'].filter((k, i, all) => sources[k] && all.indexOf(k) === i);
    if (!order.length) throw bad('Connect Apollo, Prospeo or Hunter first');
    const errors = [];
    let result = null;
    for (const k of order) {
      let found;
      try {
        found = await sources[k].run();
      } catch (e) {
        errors.push(`${sources[k].label}: ${e.message}`);
        continue;
      }
      result = { source: sources[k].label, stats: found.stats, ...addLeads(found.leads, sources[k].label) };
      if (found.leads.length) break;
    }
    if (!result) throw bad(errors.join(' '));
    return { result: { ...result, errors } };
  }],

  ['POST', /^\/api\/leads\/prospeo$/, async (b) => {
    const { leads, stats } = await prospeoFind({ ...b, departments: b.departments ?? db.profile.departments, seniority: b.seniority ?? db.profile.seniority }, secrets.prospeoKey);
    return { result: { ...stats, ...addLeads(leads, 'Prospeo') } };
  }],

  ['POST', /^\/api\/leads\/hunter$/, async (b) => {
    const { leads, stats } = await hunterFind({ ...b, departments: b.departments ?? db.profile.departments }, secrets.hunterKey);
    return { result: { ...stats, ...addLeads(leads, 'Hunter') } };
  }],

  ['POST', /^\/api\/leads\/csv$/, (b) => {
    const leads = parseLeadsCsv(b.csv);
    return { result: { rows: leads.length, ...addLeads(leads, b.source || 'CSV') } };
  }],

  ['POST', /^\/api\/leads\/([\w-]+)\/delete$/, (b, [id]) => {
    const lead = mustLead(id);
    if (['queued', 'running'].includes(lead.gen?.status)) throw bad("Wait for this lead's generation to finish");
    // Removing someone means "not this person": they go on the do-not-contact list so no search adds them again.
    block(db, lead.email, 'removed');
    db.leads = db.leads.filter((l) => l.id !== id);
    for (const ext of ['pdf', 'html']) fs.rmSync(path.join(DATA_DIR, 'decks', `${id}.${ext}`), { force: true });
    save();
  }],

  ['POST', /^\/api\/leads\/([\w-]+)\/generate$/, (b, [id]) => {
    const lead = mustLead(id);
    if (lead.outreach?.email1) throw bad('Email 1 is already sent for this lead');
    lead.approved = false;
    enqueue(lead, (l) => generateLead(l, db.profile));
  }],

  ['POST', /^\/api\/leads\/([\w-]+)\/edit$/, (b, [id]) => {
    const lead = mustLead(id);
    for (const k of ['subject', 'email1', 'followup1', 'followup2']) if (typeof b[k] === 'string') lead.gen[k] = b[k];
    save();
  }],

  ['POST', /^\/api\/leads\/([\w-]+)\/comment$/, (b, [id]) => {
    const lead = mustLead(id);
    const text = String(b.text || '').trim();
    if (!text) throw bad('Write a comment first');
    if (!lead.gen?.subject) throw bad('Generate this lead before commenting');
    const comment = { text, at: Date.now(), applied: false };
    lead.comments.push(comment);
    lead.approved = false;
    enqueue(lead, async (l) => {
      const result = await reviseLead(l, db.profile, text);
      comment.applied = true;
      return result;
    });
  }],

  ['POST', /^\/api\/leads\/([\w-]+)\/approve$/, (b, [id]) => {
    const lead = mustLead(id);
    if (b.approved && lead.gen?.status !== 'done') throw bad('Wait for the email and deck to finish first');
    lead.approved = !!b.approved;
    lead.approvedAt = lead.approved ? Date.now() : null;
    if (!lead.approved && lead.outreach?.queued) delete lead.outreach.queued;
    save();
  }],

  ['POST', /^\/api\/leads\/([\w-]+)\/send$/, async (b, [id]) => {
    const lead = mustLead(id);
    if (!lead.approved) throw bad('Approve this email on Review first');
    if (db.settings.testMode) {
      await sendStep(lead, 'email1', ctx());
      save();
      return { result: { sent: 1 } };
    }
    if (!inboxReady(secrets)) throw bad('Connect Gmail first: paste your Gmail app password in Settings.');
    if (isBlocked(db, lead.email)) throw bad(`${lead.email} is on your do-not-contact list`);
    if (lead.teamOwner) throw bad(`${teamMemberName(lead.teamOwner)} on your team is already working with ${lead.fullName || lead.email}.`);
    if (lead.outreach?.email1) throw bad('The first email already went out');
    (lead.outreach ||= {}).queued = { at: Date.now() };
    save();
    return { result: { live: true, ...(await startSending(1)) } };
  }],

  ['POST', /^\/api\/outreach\/send-approved$/, async () => {
    if (!inboxReady(secrets)) throw bad('Connect Gmail first: paste your Gmail app password in Settings.');
    const targets = db.leads.filter((l) => l.approved && !l.outreach?.email1 && !l.outreach?.queued && !isBlocked(db, l.email) && !l.teamOwner);
    if (!db.settings.testMode) {
      for (const l of targets) (l.outreach ||= {}).queued = { at: Date.now() };
      save();
      return { result: { live: true, ...(await startSending(targets.length)) } };
    }
    const errors = [];
    let sent = 0;
    for (const lead of targets) {
      try {
        await sendStep(lead, 'email1', ctx());
        sent++;
        save();
      } catch (e) {
        // A login problem fails every send the same way, so stop and say it once.
        if (e.auth) { if (!sent) throw bad(e.message); errors.push(e.message); break; }
        errors.push(`${lead.email}: ${e.message}`);
      }
    }
    return { result: { sent, errors } };
  }],

  ['POST', /^\/api\/blocked$/, (b) => {
    const entries = String(b.add || '').split(/[\s,;]+/).map((v) => v.trim()).filter(Boolean);
    if (!entries.length) throw bad('Add at least one email or website');
    const rejected = [];
    let added = 0;
    for (const v of entries) {
      const value = entryValue(v);
      if (!value) rejected.push(`${v} isn't an email or website`);
      else if (isFreeMailDomain(value)) rejected.push(`${value} would block everyone who uses it, so add single emails instead`);
      else if (block(db, value, 'manual')) added++;
    }
    save();
    if (!added && rejected.length) throw bad(rejected.join('. '));
    return { result: { added, rejected } };
  }],

  ['POST', /^\/api\/blocked\/remove$/, (b) => {
    if (!unblock(db, b.value)) throw bad("That isn't on the list");
    save();
  }],

  // ---------- team ----------
  // One licence is one seat. Everyone keeps their own Claude Code; only leads, drafts and activity meet here.
  ['POST', /^\/api\/team\/create$/, (b) => teamAnswer(createTeam(String(b.name || '').trim()))],
  ['POST', /^\/api\/team\/join$/, (b) => teamAnswer(joinTeam(String(b.code || '').trim(), String(b.name || '').trim()))],
  ['POST', /^\/api\/team\/invite$/, () => teamAnswer(inviteToTeam())],
  ['POST', /^\/api\/team\/rename$/, (b) => teamAnswer(renameTeam(String(b.name || '').trim()))],
  ['POST', /^\/api\/team\/remove$/, (b) => teamAnswer(removeTeamMember(String(b.memberId || '')))],
  ['POST', /^\/api\/team\/leave$/, () => teamAnswer(leaveTeam())],
  ['POST', /^\/api\/team\/sync$/, () => teamAnswer(syncTeam({ force: true }))],

  ['POST', /^\/api\/outreach\/tick$/, async () => {
    const result = await tick(ctx(), { force: true });
    save();
    return { result };
  }],
];

// These answer without a license: the launcher's health check and the key screen itself.
// The installed app asks for a key (lib/license.js); ./run.sh from the repo never does.
const VERSION = JSON.parse(fs.readFileSync(path.join(import.meta.dirname, 'package.json'), 'utf8')).version;
const openRoutes = [
  ['GET', /^\/api\/health$/, () => ({ app: '4ruple', version: VERSION })],
  ['GET', /^\/api\/license$/, () => licenseStatus()],
  ['POST', /^\/api\/license\/activate$/, (b) => activateLicense(b.key, b.email)],
  ['POST', /^\/api\/license\/remove-device$/, (b) => removeDevice(b.key, String(b.deviceId || ''))],
  ['POST', /^\/api\/license\/deactivate$/, () => deactivateThisDevice()],
];

// ---------- http ----------
const LOCAL_HOST = /^(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/;
const LOCAL_ORIGIN = /^http:\/\/(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/;
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.pdf': 'application/pdf', '.svg': 'image/svg+xml' };

async function readJson(req) {
  const chunks = [];
  let size = 0;
  for await (const c of req) {
    size += c.length;
    if (size > 15_000_000) throw new HttpError(413, 'Upload too large');
    chunks.push(c);
  }
  if (!chunks.length) return {};
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { throw bad('Invalid JSON'); }
}

function serveFile(res, file) {
  if (!fs.existsSync(file) || !fs.statSync(file).isFile()) throw new HttpError(404, 'Not found');
  res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-store' });
  fs.createReadStream(file).pipe(res);
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  try {
    // Only this laptop's browser may drive the app: a web page elsewhere can't post to it, and a DNS
    // rebinding trick can't reach it under another host name.
    if (!LOCAL_HOST.test(req.headers.host || '')) throw new HttpError(403, 'Forbidden');
    if (req.method !== 'GET' && req.headers.origin && !LOCAL_ORIGIN.test(req.headers.origin)) throw new HttpError(403, 'Forbidden');
    if (url.pathname.startsWith('/api/')) {
      for (const [method, re, handler] of openRoutes) {
        if (req.method !== method || !re.test(url.pathname)) continue;
        const out = await handler(method === 'POST' ? await readJson(req) : {});
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(out));
        return;
      }
      const license = await licenseStatus();
      if (!license.ok) throw Object.assign(new HttpError(402, license.error), { license });
      for (const [method, re, handler] of routes) {
        const m = url.pathname.match(re);
        if (!m || req.method !== method) continue;
        const body = method === 'POST' ? await readJson(req) : {};
        const out = await handler(body, m.slice(1));
        res.writeHead(200, { 'Content-Type': 'application/json' });
        // Handlers return nothing, or extras like { result }; fresh state is built after they've run.
        res.end(JSON.stringify({ ...(out?.leads ? out : { ...publicState(), ...(out || {}) }), license }));
        return;
      }
      throw new HttpError(404, 'No such API route');
    }
    const deck = url.pathname.match(/^\/decks\/([\w-]+)\.(pdf|html|png)$/);
    if (deck) return serveFile(res, path.join(DATA_DIR, 'decks', `${deck[1]}.${deck[2]}`));
    const file = path.join(PUBLIC_DIR, path.normalize(url.pathname === '/' ? 'index.html' : url.pathname));
    if (!file.startsWith(PUBLIC_DIR + path.sep)) throw new HttpError(403, 'Forbidden');
    return serveFile(res, file);
  } catch (e) {
    // Errors thrown from lib/ carry user-facing messages (missing key, bad CSV, SMTP refusal).
    const status = e.status || 400;
    if (!e.status) console.error(`[${req.method} ${url.pathname}]`, e.message);
    if (!res.headersSent) res.writeHead(status, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: e.message, ...(e.license && { license: e.license }) }));
  }
});

server.listen(PORT, HOST, () => {
  console.log(`4ruple running at http://localhost:${PORT}`);
});

// Follow-ups and reply checks run in the background, and stop if the license does.
setInterval(() => {
  // A team laptop also pushes the day's work and pulls what the rest of the team did.
  syncTeam().catch((e) => console.error('[team]', e.message));
  licenseStatus().then((license) => license.ok && tick(ctx())).then((r) => {
    if (!r) return;
    if (r.sent || r.replies || r.bounced) save();
    if (r.errors?.length) console.error('[outreach]', r.errors.join(' | '));
  }).catch((e) => console.error('[outreach]', e.message));
}, 60 * 1000);
