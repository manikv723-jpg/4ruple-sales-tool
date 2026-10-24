// Sending hours: real emails only go out on the days and hours set on Send, in the sender's time zone,
// and never more than the daily limit. Preview emails ignore all of this.
const MINUTE = 60 * 1000;
const WEEKDAY = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
const SYSTEM_TZ = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';

export function validTimezone(tz) {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: String(tz) });
    return !!tz;
  } catch {
    return false;
  }
}
export const timezoneOf = (s) => (validTimezone(s.timezone) ? s.timezone : SYSTEM_TZ);

// "09:30" -> 570 minutes after midnight, or null when it isn't a time.
export function toMinutes(hhmm) {
  const m = /^(\d{1,2}):(\d{2})$/.exec(String(hhmm || ''));
  return m && Number(m[1]) < 24 && Number(m[2]) < 60 ? Number(m[1]) * 60 + Number(m[2]) : null;
}
export const fromMinutes = (n) => `${String(Math.floor(n / 60)).padStart(2, '0')}:${String(n % 60).padStart(2, '0')}`;

const formatters = new Map();
function localParts(ms, tz) {
  if (!formatters.has(tz)) {
    formatters.set(tz, new Intl.DateTimeFormat('en-US', { timeZone: tz, weekday: 'short', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }));
  }
  const p = Object.fromEntries(formatters.get(tz).formatToParts(new Date(ms)).map((x) => [x.type, x.value]));
  return { day: WEEKDAY[p.weekday], date: `${p.year}-${p.month}-${p.day}`, minutes: (Number(p.hour) % 24) * 60 + Number(p.minute) };
}

export function inWindow(s, ms = Date.now()) {
  const p = localParts(ms, timezoneOf(s));
  if (!s.weekends && (p.day === 0 || p.day === 6)) return false;
  const from = toMinutes(s.sendFrom) ?? 540;
  const to = toMinutes(s.sendTo) ?? 1080;
  if (from === to) return false;
  // An end before the start means the window runs past midnight, like 22:00 to 02:00.
  return from < to ? p.minutes >= from && p.minutes < to : p.minutes >= from || p.minutes < to;
}

// The next moment sending hours are open, checked in 5-minute steps across the coming 8 days.
export function nextWindow(s, ms = Date.now()) {
  if (inWindow(s, ms)) return ms;
  const step = 5 * MINUTE;
  const end = ms + 8 * 24 * 60 * MINUTE;
  for (let t = Math.ceil(ms / step) * step; t <= end; t += step) if (inWindow(s, t)) return t;
  return null;
}

// Real emails (first emails and follow-ups) sent today in the sender's time zone.
export function sentToday(leads, s, ms = Date.now()) {
  const tz = timezoneOf(s);
  const today = localParts(ms, tz).date;
  let n = 0;
  for (const l of leads) {
    for (const k of ['email1', 'followup1', 'followup2']) {
      const x = l.outreach?.[k];
      if (x && !x.test && localParts(x.sentAt, tz).date === today) n++;
    }
  }
  return n;
}

export const dailyCap = (s) => Math.min(Math.max(Math.round(Number(s.dailyCap)) || 50, 1), 500);
