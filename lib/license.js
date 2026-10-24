// License check for the installed app (npx 4ruple). A key is activated once per device against the 4ruple
// license service, which answers with a signed pass. The pass works offline for 7 days, refreshes quietly
// after 3, and gets 7 more days of grace when the service can't be reached.
// Running from the repo (./run.sh) skips all of this: only the launcher sets FOURUPLE_REQUIRE_LICENSE=1.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash, randomBytes } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { DATA_DIR } from './store.js';
import { normalizeKey, importVerifyKey, readPass } from './license-core.js';

export const LICENSE_REQUIRED = process.env.FOURUPLE_REQUIRE_LICENSE === '1';
// The Supabase project that runs supabase/functions/license. Set once the project exists.
const API = process.env.FOURUPLE_LICENSE_API || 'https://REPLACE-WITH-PROJECT-REF.supabase.co/functions/v1/license';
// Public half of the pass-signing key (scripts/license-keygen.mjs). Safe to ship: it can only check passes.
const PUBLIC_KEY = process.env.FOURUPLE_LICENSE_PUBLIC_KEY || 'uWjsbhJR0pEbIQ3SlJDiS54TeLUGH1qcN6-jCJToA4s';
const VERSION = JSON.parse(fs.readFileSync(path.join(import.meta.dirname, '..', 'package.json'), 'utf8')).version;
const FILE = path.join(DATA_DIR, 'license.json');
const DAY = 86_400_000;
const REFRESH_AFTER = 3 * DAY;
const OFFLINE_GRACE = 7 * DAY;
const RECHECK_FAILED_AFTER = 30_000;

let verifyKey;
const publicKey = () => (verifyKey ||= importVerifyKey(PUBLIC_KEY));

// A hash of the machine's own id, so the service can count devices without learning anything about them.
let device;
export function deviceHash() {
  if (device) return device;
  // FOURUPLE_DEVICE_ID stands in for the machine id, so two copies on one Mac can act as two laptops.
  let id = process.env.FOURUPLE_DEVICE_ID || null;
  try {
    if (id) { /* set by hand */ }
    else if (process.platform === 'darwin') {
      id = execFileSync('ioreg', ['-rd1', '-c', 'IOPlatformExpertDevice'], { encoding: 'utf8' }).match(/"IOPlatformUUID" = "([^"]+)"/)?.[1];
    } else if (process.platform === 'win32') {
      id = execFileSync('reg', ['query', 'HKLM\\SOFTWARE\\Microsoft\\Cryptography', '/v', 'MachineGuid'], { encoding: 'utf8' }).match(/MachineGuid\s+REG_SZ\s+(\S+)/)?.[1];
    } else {
      id = ['/etc/machine-id', '/var/lib/dbus/machine-id'].map((f) => { try { return fs.readFileSync(f, 'utf8').trim(); } catch { return ''; } }).find(Boolean);
    }
  } catch { /* fall back to a stored random id */ }
  if (!id) {
    const file = path.join(DATA_DIR, 'device-id');
    try { id = fs.readFileSync(file, 'utf8').trim(); } catch { id = randomBytes(16).toString('hex'); fs.writeFileSync(file, id); }
  }
  return (device = createHash('sha256').update(`4ruple-device:${id}`).digest('hex'));
}

const readSaved = () => { try { return JSON.parse(fs.readFileSync(FILE, 'utf8')); } catch { return null; } };
// The team service needs the same key, and only a paid licence can be on a team.
export const licenceKey = () => readSaved()?.key || null;
function writeSaved(value) {
  const tmp = `${FILE}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(value, null, 2), { mode: 0o600 });
  fs.renameSync(tmp, FILE);
}

async function call(action, key, extra = {}) {
  const offline = (error) => ({ ok: false, offline: true, code: 'OFFLINE', error });
  let res;
  try {
    res = await fetch(API, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action,
        key,
        device: deviceHash(),
        name: os.hostname().replace(/\.local$/, ''),
        platform: `${process.platform}-${process.arch}`,
        version: VERSION,
        ...extra,
      }),
      signal: AbortSignal.timeout(12_000),
    });
  } catch {
    return offline("Couldn't reach the 4ruple license service. Check your internet connection and try again.");
  }
  if (res.status >= 500) return offline('The 4ruple license service is having trouble. Try again in a minute.');
  try { return await res.json(); } catch { return offline(`The license service sent an unexpected answer (${res.status}).`); }
}

const view = (saved, pass, extra = {}) => ({
  ok: true,
  required: true,
  plan: pass.plan,
  hint: pass.hint,
  email: saved.license?.email || '',
  devicesUsed: saved.license?.devicesUsed ?? null,
  maxDevices: saved.license?.maxDevices ?? null,
  validUntil: pass.exp,
  ...extra,
});

let memo = null; // the last failed check, so a missing key or dead network isn't retried on every request
export const forgetLicenseCheck = () => { memo = null; };

export async function licenseStatus() {
  if (!LICENSE_REQUIRED) return { ok: true, required: false };
  const now = Date.now();
  if (memo && now - memo.at < RECHECK_FAILED_AFTER) return memo.result;
  const result = await check(now);
  memo = result.ok ? null : { at: now, result };
  return result;
}

async function check(now) {
  const saved = readSaved();
  if (!saved?.key) return { ok: false, required: true, code: 'NO_KEY', error: 'Add your licence key to start using 4ruple.' };
  const raw = saved.token ? await readPass(saved.token, await publicKey()) : null;
  const pass = raw?.v === 1 && raw.dev === deviceHash() ? raw : null;
  if (pass && now < pass.exp) {
    if (now - pass.iat > REFRESH_AFTER) refresh(saved).catch(() => {});
    return view(saved, pass);
  }
  const r = await refresh(saved);
  if (r.ok) return r;
  if (r.offline && pass && now < pass.exp + OFFLINE_GRACE) return view(saved, pass, { offline: true });
  return { required: true, ...r, ok: false };
}

let refreshing = null;
function refresh(saved) {
  refreshing ||= (async () => {
    const r = await call('refresh', saved.key);
    if (!r.ok) {
      // A revoked key or a removed device ends the pass now, not when it would have expired.
      if (!r.offline) writeSaved({ ...readSaved(), token: null });
      return r;
    }
    return store(saved.key, r);
  })().finally(() => { refreshing = null; });
  return refreshing;
}

async function store(key, r) {
  const pass = await readPass(r.token, await publicKey());
  if (!pass || pass.dev !== deviceHash()) {
    return { ok: false, code: 'BAD_PASS', error: "The license service's answer couldn't be verified. Update with npx 4ruple@latest and try again." };
  }
  const saved = { key, token: r.token, license: r.license, checkedAt: Date.now() };
  writeSaved(saved);
  memo = null;
  return view(saved, pass);
}

// A key only works with the email it was bought with, so both are asked for once.
export async function activateLicense(input, email) {
  const key = normalizeKey(input);
  if (!key) return { ok: false, code: 'INVALID_KEY', error: "That doesn't look like a 4ruple key. It starts with 4R- and has four groups of letters and numbers." };
  const address = String(email ?? '').trim();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(address)) return { ok: false, code: 'EMAIL_NEEDED', error: 'Add the email address you bought 4ruple with.' };
  const r = await call('activate', key, { email: address });
  return r.ok ? store(key, r) : r;
}

// Frees a slot on the key, for a device that's lost, sold or replaced. Works before this laptop is activated.
export async function removeDevice(input, deviceId) {
  const key = normalizeKey(input) || readSaved()?.key;
  if (!key) return { ok: false, code: 'INVALID_KEY', error: 'Add your license key first.' };
  return call('deactivate', key, { deviceId });
}

export async function deactivateThisDevice() {
  const saved = readSaved();
  if (!saved?.key) return { ok: true, removed: false };
  const r = await call('deactivate', saved.key);
  if (!r.ok && r.code !== 'NO_DEVICE') return r;
  fs.rmSync(FILE, { force: true });
  memo = null;
  return { ok: true, removed: true };
}
