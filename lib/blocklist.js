// The do-not-contact list: people and companies that are never added or emailed again.
// It fills itself (people you remove, anyone who says no, emails that bounce) and takes entries by hand
// (clients, companies you already talk to).
const FREE_MAIL = new Set(['gmail.com', 'googlemail.com', 'yahoo.com', 'outlook.com', 'hotmail.com', 'live.com', 'icloud.com', 'aol.com', 'proton.me', 'rediffmail.com']);

export const REASONS = { removed: 'removed by you', declined: 'said not interested', bounced: 'email bounced', manual: 'added by you' };

const normal = (v) => String(v || '').trim().toLowerCase().replace(/^mailto:/, '');

// An email stays an email; anything else becomes a bare domain, so https://www.brand.in/about is brand.in.
export function entryValue(v) {
  const s = normal(v);
  if (s.includes('@')) return /^[^@\s]+@[^@\s]+\.[a-z]{2,}$/.test(s) ? s : '';
  const domain = s.replace(/^https?:\/\//, '').replace(/^www\./, '').split(/[/?#\s]/)[0];
  return /^[a-z0-9-]+(\.[a-z0-9-]+)*\.[a-z]{2,}$/.test(domain) ? domain : '';
}

// Blocking gmail.com would block everyone who uses it.
export const isFreeMailDomain = (v) => FREE_MAIL.has(v);

export function isBlocked(db, email) {
  const e = normal(email);
  const domain = e.split('@')[1];
  return (db.blocked || []).some((b) => b.value === e || (domain && b.value === domain));
}

export function block(db, value, reason) {
  const v = entryValue(value);
  if (!v || (!v.includes('@') && FREE_MAIL.has(v))) return false;
  db.blocked ||= [];
  if (db.blocked.some((b) => b.value === v)) return false;
  db.blocked.push({ value: v, reason, at: Date.now() });
  // Anything queued or mid-sequence for this person or company stops here.
  const one = { blocked: [{ value: v }] };
  for (const l of db.leads || []) {
    if (!isBlocked(one, l.email)) continue;
    const o = (l.outreach ||= {});
    delete o.queued;
    if (o.email1 && !['replied', 'bounced'].includes(o.status)) o.stopped = REASONS[reason] || reason;
  }
  return true;
}

export function unblock(db, value) {
  const v = entryValue(value) || normal(value);
  const before = (db.blocked || []).length;
  db.blocked = (db.blocked || []).filter((b) => b.value !== v);
  return db.blocked.length < before;
}
