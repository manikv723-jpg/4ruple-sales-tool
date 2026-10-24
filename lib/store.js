// Local JSON store. Everything lives in one data folder so the app runs with no database:
// ./data from the repo, ~/.4ruple/data when installed with npx (the launcher sets FOURUPLE_DATA_DIR).
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

export const DATA_DIR = path.resolve(process.env.FOURUPLE_DATA_DIR || path.join(import.meta.dirname, '..', 'data'));
const DB_FILE = path.join(DATA_DIR, 'db.json');
const SECRETS_FILE = path.join(DATA_DIR, 'secrets.json');

fs.mkdirSync(path.join(DATA_DIR, 'decks'), { recursive: true });

const defaults = () => ({
  profile: {
    senderName: '', senderTitle: '', companyName: '', website: '',
    portfolioLinks: '', brandWork: '', notableClients: '', about: '', icp: '',
    departments: [], seniority: [], whatYouSolve: '', calendly: '',
  },
  settings: {
    testMode: true, gap1: 3, gap2: 4, gapUnit: 'days',
    // Real emails only go out inside these hours, in this time zone, up to dailyCap a day.
    sendFrom: '09:00', sendTo: '18:00', weekends: false, dailyCap: 50,
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC',
    perCompany: 4, leadSource: 'auto',
  },
  leads: [],
  blocked: [],
  // Set once this laptop joins a team: { id, name, role, memberId, members, leads, events, totals, syncedAt, queue }
  team: null,
});

function readJson(file, fallback) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return fallback; }
}

function writeJson(file, value) {
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(value, null, 2));
  fs.renameSync(tmp, file);
}

const loaded = readJson(DB_FILE, {});
const base = defaults();
export const db = {
  profile: { ...base.profile, ...loaded.profile },
  settings: { ...base.settings, ...loaded.settings },
  leads: loaded.leads || [],
  blocked: loaded.blocked || [],
  team: loaded.team || null,
};

export const secrets = readJson(SECRETS_FILE, {});

export const save = () => writeJson(DB_FILE, db);
export const saveSecrets = () => writeJson(SECRETS_FILE, secrets);
export const newId = () => crypto.randomBytes(6).toString('hex');
