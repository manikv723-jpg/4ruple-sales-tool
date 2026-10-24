// Sending (SMTP with a Gmail app password) and reply tracking (IMAP). No Google app review needed.
import fs from 'node:fs';
import path from 'node:path';
import nodemailer from 'nodemailer';
import { ImapFlow } from 'imapflow';
import { simpleParser } from 'mailparser';
import { DATA_DIR } from './store.js';
import { classifyReply } from './generate.js';
import { inWindow, sentToday, dailyCap } from './schedule.js';
import { isBlocked, block } from './blocklist.js';

const DAY = 24 * 60 * 60 * 1000;
const MINUTE = 60 * 1000;
const STEPS = ['email1', 'followup1', 'followup2'];

// A Gmail app password is 16 letters (Google shows it in four groups). Anything else, like the account
// password or an API key, gets "535 BadCredentials", so it is caught before it is saved.
const bare = (p) => String(p || '').replace(/\s+/g, '');
export const appPasswordLooksRight = (p) => /^[a-z]{16}$/i.test(bare(p));
export const inboxReady = (s) => !!(s.inboxEmail && appPasswordLooksRight(s.appPassword));
export const APP_PASSWORD_HELP = "A Gmail app password is 16 letters, shown by Google like abcd efgh ijkl mnop. Turn on 2-step verification, make one at myaccount.google.com/apppasswords, and paste it here. Your normal Gmail password won't work.";

export const isAuthError = (e) => !!e?.authenticationFailed || /\b53[45]\b|BadCredentials|Invalid login|AUTHENTICATIONFAILED|Invalid credentials|Application-specific password/i.test(String(e?.message || e));
const explainMailError = (e) => (isAuthError(e) ? Object.assign(new Error("Gmail didn't accept your address and app password. Paste a new app password in Settings."), { auth: true }) : e);

function transporter(s) {
  return nodemailer.createTransport({
    host: s.smtpHost || 'smtp.gmail.com',
    port: 465,
    secure: true,
    auth: { user: s.inboxEmail, pass: s.appPassword.replace(/\s+/g, '') },
  });
}

export async function verifyInbox(s) {
  if (!s.inboxEmail || !s.appPassword) throw new Error('Add your Gmail address and app password first');
  if (!appPasswordLooksRight(s.appPassword)) throw Object.assign(new Error(`That isn't a Gmail app password. ${APP_PASSWORD_HELP}`), { auth: true });
  try {
    await transporter(s).verify();
    const client = new ImapFlow({ host: s.imapHost || 'imap.gmail.com', port: 993, secure: true, auth: { user: s.inboxEmail, pass: bare(s.appPassword) }, logger: false });
    await client.connect();
    await client.logout();
  } catch (e) {
    if (isAuthError(e)) throw Object.assign(new Error(`Gmail didn't accept ${s.inboxEmail} with that app password. ${APP_PASSWORD_HELP}`), { auth: true });
    throw e;
  }
}

export function nextDue(lead, settings) {
  const o = lead.outreach || {};
  // A live first email waiting for sending hours is due from the moment it was queued.
  if (!o.email1) return o.queued ? { step: 'email1', at: o.queued.at, test: false } : null;
  if (['replied', 'bounced'].includes(o.status) || o.stopped) return null;
  const unit = settings.gapUnit === 'minutes' ? MINUTE : DAY;
  const test = !!o.email1.test;
  if (!o.followup1) return { step: 'followup1', at: o.email1.sentAt + Number(settings.gap1) * unit, test };
  if (!o.followup2) return { step: 'followup2', at: o.followup1.sentAt + Number(settings.gap2) * unit, test };
  return null;
}

const signature = (p) => [p.senderName, [p.senderTitle, p.companyName].filter(Boolean).join(', '), p.website].filter(Boolean).join('\n');

function textToHtml(text) {
  const esc = text.replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
  const linked = esc.replace(/https?:\/\/[^\s<]+/g, (u) => `<a href="${u}">${u}</a>`);
  return `<div style="font-family:Arial,sans-serif;font-size:14px;line-height:1.55;color:#222">${linked.split(/\n{2,}/).map((p) => `<p style="margin:0 0 12px">${p.replace(/\n/g, '<br>')}</p>`).join('')}</div>`;
}

export async function sendStep(lead, step, { db, secrets, profile, settings }, { test: forceTest } = {}) {
  if (!STEPS.includes(step)) throw new Error(`Unknown step ${step}`);
  if (!inboxReady(secrets)) throw new Error('Connect Gmail in Settings first');
  if (db && isBlocked(db, lead.email)) throw new Error(`${lead.email} is on your do-not-contact list`);
  const g = lead.gen || {};
  if (!g[step]) throw new Error(`${step} is empty`);
  const o = (lead.outreach ||= {});
  if (o[step]) throw new Error(`${step} was already sent`);

  // A sequence stays in the mode it started in: preview threads keep going to your inbox, real ones to the person.
  const test = step === 'email1' ? (forceTest ?? !!settings.testMode) : !!o.email1?.test;
  const to = test ? secrets.inboxEmail : lead.email;
  let subject = step === 'email1' ? g.subject : `Re: ${g.subject}`;
  if (test) subject = `[TEST for ${lead.email}] ${subject}`;
  const text = `${g[step].trim()}\n\n${signature(profile)}`;

  const mail = {
    from: { name: profile.senderName || secrets.inboxEmail, address: secrets.inboxEmail },
    to,
    subject,
    text,
    html: textToHtml(text),
  };
  if (step === 'email1') {
    const deck = g.deckPath && path.join(DATA_DIR, 'decks', g.deckPath);
    if (deck && fs.existsSync(deck)) {
      const name = `${lead.company || 'Deck'} x ${profile.companyName || 'us'}.pdf`.replace(/[\\/:*?"<>|]/g, '');
      mail.attachments = [{ filename: name, path: deck }];
    }
  } else {
    const previous = [o.email1?.messageId, o.followup1?.messageId].filter(Boolean);
    mail.inReplyTo = previous.at(-1);
    mail.references = previous;
  }

  const info = await transporter(secrets).sendMail(mail).catch((e) => { throw explainMailError(e); });
  o[step] = { sentAt: Date.now(), messageId: info.messageId, to, test };
  if (step === 'email1') {
    o.status = 'awaiting';
    delete o.queued;
  }
  delete o.lastError;
}

function stripQuoted(text) {
  const cut = text.search(/\n(On .+wrote:|-{2,}\s*Original Message|From: .+\n)/i);
  return (cut > 0 ? text.slice(0, cut) : text).trim();
}

async function checkReplies(ctx) {
  const { db, secrets, profile } = ctx;
  // Test-mode emails went to your own inbox, so there's no real reply to look for.
  const awaiting = db.leads.filter((l) => l.outreach?.email1 && l.outreach.status === 'awaiting' && !l.outreach.email1.test && !l.outreach.stopped);
  if (!awaiting.length) return { checked: 0, replies: 0 };

  const client = new ImapFlow({
    host: secrets.imapHost || 'imap.gmail.com', port: 993, secure: true,
    auth: { user: secrets.inboxEmail, pass: secrets.appPassword.replace(/\s+/g, '') }, logger: false,
  });
  await client.connect();
  let replies = 0;
  let bounced = 0;
  const lock = await client.getMailboxLock('INBOX');
  try {
    for (const lead of awaiting) {
      const o = lead.outreach;
      const since = new Date(o.email1.sentAt - DAY);
      // A bounce comes from the mail server, not the person, and quotes the address that failed.
      const bounces = await client.search({ or: [{ from: 'mailer-daemon' }, { from: 'postmaster' }], body: lead.email, since }, { uid: true });
      if (bounces?.length) {
        Object.assign(o, { status: 'bounced', bouncedAt: Date.now() });
        block(db, lead.email, 'bounced');
        bounced++;
        continue;
      }
      const uids = await client.search({ from: lead.email, since }, { uid: true });
      if (!uids?.length) continue;
      const msg = await client.fetchOne(String(uids.at(-1)), { source: true }, { uid: true });
      const parsed = await simpleParser(msg.source);
      if (parsed.date && parsed.date.getTime() < o.email1.sentAt) continue;
      const reply = stripQuoted(parsed.text || '').slice(0, 4000);
      if (o.lastReplyChecked === parsed.messageId) continue;
      const verdict = await classifyReply(lead, reply, profile);
      o.lastReplyChecked = parsed.messageId;
      o.replySnippet = reply.slice(0, 300);
      o.replySummary = verdict.summary;
      o.nextSteps = verdict.nextSteps;
      if (verdict.isAutoReply) {
        o.autoReply = true;
        continue;
      }
      Object.assign(o, { status: 'replied', repliedAt: parsed.date?.getTime() || Date.now(), temperature: verdict.temperature });
      if (verdict.temperature === 'cold') block(db, lead.email, 'declined');
      replies++;
    }
  } finally {
    lock.release();
    await client.logout().catch(() => {});
  }
  return { checked: awaiting.length, replies, bounced };
}

let ticking = false;
let lastReplyCheck = 0;

// Runs every minute: check replies first (at most every 5 min), then send any follow-ups that are due.
export async function tick(ctx, { force = false } = {}) {
  if (ticking) return { busy: true };
  ticking = true;
  const result = { checked: 0, replies: 0, bounced: 0, sent: 0, errors: [] };
  try {
    if (!inboxReady(ctx.secrets)) return result;
    if (force || Date.now() - lastReplyCheck > 5 * MINUTE) {
      lastReplyCheck = Date.now();
      try { Object.assign(result, await checkReplies(ctx)); } catch (e) { result.errors.push(`Reply check: ${e.message}`); }
    }
    // Real emails go out one a minute, inside sending hours and under the daily limit.
    // Preview emails only reach your own inbox, so they go straight away.
    const { db, settings } = ctx;
    let realSlots = inWindow(settings) ? Math.min(1, dailyCap(settings) - sentToday(db.leads, settings)) : 0;
    for (const lead of db.leads) {
      const due = nextDue(lead, settings);
      if (!due || due.at > Date.now()) continue;
      if (!due.test && realSlots <= 0) continue;
      const o = lead.outreach;
      if (o.lastErrorAt && Date.now() - o.lastErrorAt < 30 * MINUTE) continue;
      if (!due.test) realSlots--;
      try {
        await sendStep(lead, due.step, ctx, { test: due.test });
        result.sent++;
      } catch (e) {
        o.lastError = e.message;
        o.lastErrorAt = Date.now();
        result.errors.push(`${lead.email}: ${e.message}`);
        if (e.auth) break;
      }
    }
  } finally {
    ticking = false;
  }
  return result;
}
