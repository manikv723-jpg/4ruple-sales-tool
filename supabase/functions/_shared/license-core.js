// License rules for 4ruple.ai, shared by the Supabase edge functions (Deno) and the installed app (Node).
// Only Web Crypto and plain objects, so this one file runs in both. A copy lives in
// supabase/functions/_shared/license-core.js; the tests fail if the two drift apart.

export const TOKEN_DAYS = 7;
// One device per licence, matching what basementprotocol.com/4ruple sells. A pack is several keys, not
// several devices on one key.
export const DEFAULT_MAX_DEVICES = 1;
export const DEACTIVATIONS_PER_30_DAYS = 5;
// One address can only activate so many keys in a day, so a leaked key can't be spread from one place.
export const ACTIVATIONS_PER_IP_DAY = 20;
const DAY = 86_400_000;
const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ'; // Crockford base32: no I, L, O or U to misread
const enc = new TextEncoder();
const dec = new TextDecoder();

export function b64url(bytes) {
  let s = '';
  for (const b of new Uint8Array(bytes)) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function fromB64url(text) {
  const s = String(text).replace(/-/g, '+').replace(/_/g, '/');
  return Uint8Array.from(atob(s + '='.repeat((4 - (s.length % 4)) % 4)), (c) => c.charCodeAt(0));
}

const hex = (buf) => [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');

// ---------- keys ----------
// 20 random base32 characters (100 bits), shown as 4R-XXXXX-XXXXX-XXXXX-XXXXX.
export function newLicenseKey() {
  const body = [...crypto.getRandomValues(new Uint8Array(20))].map((b) => ALPHABET[b & 31]).join('');
  return `4R-${body.match(/.{5}/g).join('-')}`;
}

// People paste keys with spaces, in lowercase, or with O for 0. Returns the canonical key, or null.
export function normalizeKey(input) {
  let s = String(input ?? '').toUpperCase().replace(/[^0-9A-Z]/g, '').replace(/O/g, '0').replace(/[IL]/g, '1');
  if (s.length === 22 && s.startsWith('4R')) s = s.slice(2);
  if (s.length !== 20 || [...s].some((c) => !ALPHABET.includes(c))) return null;
  return `4R-${s.match(/.{5}/g).join('-')}`;
}

export const sha256Hex = async (text) => hex(await crypto.subtle.digest('SHA-256', enc.encode(text)));
// Only this hash is stored. The key itself exists in the buyer's email and on their laptop.
export const keyHash = (key) => sha256Hex(`4ruple-license:${key}`);
export const keyHint = (key) => key.slice(-5);

export async function hmacSha256Hex(secret, text) {
  const k = await crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return hex(await crypto.subtle.sign('HMAC', k, enc.encode(text)));
}

const b64std = (bytes) => { let s = ''; for (const b of new Uint8Array(bytes)) s += String.fromCharCode(b); return btoa(s); };

// Standard Webhooks signatures (Dodo Payments): base64 HMAC-SHA256 of "id.timestamp.body", keyed with the
// base64 secret after "whsec_". The header can carry several "v1,<sig>" entries during a secret rotation.
export async function standardWebhookValid(secret, headers, body, { now = Date.now(), toleranceSeconds = 300 } = {}) {
  const id = headers['webhook-id'];
  const timestamp = headers['webhook-timestamp'];
  const signatures = headers['webhook-signature'];
  if (!secret || !id || !timestamp || !signatures) return false;
  if (!(Math.abs(now / 1000 - Number(timestamp)) <= toleranceSeconds)) return false;
  let keyBytes;
  try { keyBytes = Uint8Array.from(atob(String(secret).replace(/^whsec_/, '')), (c) => c.charCodeAt(0)); } catch { return false; }
  const k = await crypto.subtle.importKey('raw', keyBytes, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const expected = b64std(await crypto.subtle.sign('HMAC', k, enc.encode(`${id}.${timestamp}.${body}`)));
  return String(signatures).split(' ').some((entry) => sameText(entry.split(',')[1], expected));
}

// Constant-time comparison for signatures and tokens.
export function sameText(a, b) {
  a = String(a ?? '');
  b = String(b ?? '');
  if (!a.length || a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

// ---------- signed passes ----------
// A pass says "this license is active on this device until exp". The service signs it with a private key;
// the app checks it with the public key, so it keeps working offline until the pass expires.
export const importSigningKey = (jwk) =>
  crypto.subtle.importKey('jwk', typeof jwk === 'string' ? JSON.parse(jwk) : jwk, { name: 'Ed25519' }, false, ['sign']);
export const importVerifyKey = (raw) => crypto.subtle.importKey('raw', fromB64url(raw), { name: 'Ed25519' }, false, ['verify']);

export async function signPass(payload, privateKey) {
  const body = b64url(enc.encode(JSON.stringify(payload)));
  return `${body}.${b64url(await crypto.subtle.sign('Ed25519', privateKey, enc.encode(body)))}`;
}

export async function readPass(token, publicKey) {
  const [body, sig, extra] = String(token ?? '').split('.');
  if (!body || !sig || extra !== undefined) return null;
  try {
    if (!(await crypto.subtle.verify('Ed25519', publicKey, fromB64url(sig), enc.encode(body)))) return null;
    return JSON.parse(dec.decode(fromB64url(body)));
  } catch {
    return null;
  }
}

// ---------- the license service ----------
const fail = (status, code, error, extra = {}) => ({ status, json: { ok: false, code, error, ...extra } });
const WRONG_KEY = "That license key isn't right. Copy it again from your purchase email.";
const deviceList = (rows) => rows.map((d) => ({ id: d.id, name: d.device_name || 'Unnamed device', platform: d.platform || '', lastSeen: d.last_seen_at }));
const maskEmail = (email) => String(email || '').replace(/^(.)[^@]*?(.)?@/, (m, first, last) => `${first}•••${last || ''}@`);

/**
 * Handles one request from the app or the manage page: trial, activate, refresh, deactivate or devices.
 * store: findLicense(keyHash), devices(licenseId), upsertDevice(licenseId, device), touchDevice(id, meta),
 *        deactivateDevice(id), logEvent(licenseId, type, meta), countEvents(licenseId, type, sinceIso),
 *        countIpActivations(ipHash, day), addIpActivation(ipHash, day)
 */
export async function handleLicenseRequest(body, { store, privateKey, now = Date.now(), ip = null }) {
  const action = body?.action;
  if (!['activate', 'refresh', 'deactivate', 'devices'].includes(action)) return fail(400, 'BAD_REQUEST', 'Unknown action');
  const device = String(body.device || '');
  const hasDevice = /^[a-f0-9]{64}$/.test(device);
  const ipHash = ip ? await sha256Hex(`4ruple-ip:${ip}`) : null;
  const meta = {
    device_name: String(body.name || '').slice(0, 80) || null,
    platform: String(body.platform || '').slice(0, 40) || null,
    app_version: String(body.version || '').slice(0, 20) || null,
    last_ip_hash: ipHash,
  };

  const key = normalizeKey(body.key);
  if (!key) return fail(400, 'INVALID_KEY', WRONG_KEY);
  // Listing devices and freeing a seat by id only need the key, so the manage page on the website works too.
  const needsDevice = action === 'activate' || action === 'refresh' || (action === 'deactivate' && !body.deviceId);
  if (needsDevice && !hasDevice) return fail(400, 'BAD_REQUEST', 'Missing device id');

  const license = await store.findLicense(await keyHash(key));
  if (!license) return fail(404, 'INVALID_KEY', WRONG_KEY);
  if (license.status !== 'active') return fail(403, 'REVOKED', 'This license is no longer active. Reply to your purchase email if that looks wrong.');

  // A key belongs to the person who bought it: it only activates with the email it was sent to.
  if (action === 'activate') {
    const email = String(body.email ?? '').trim().toLowerCase();
    if (!email) return fail(400, 'EMAIL_NEEDED', 'Add the email address you bought 4ruple with.');
    if (email !== String(license.email || '').toLowerCase()) {
      return fail(403, 'EMAIL_MISMATCH', "That key wasn't bought with this email address. Use the one your key was sent to.");
    }
    if (ipHash) {
      const day = new Date(now).toISOString().slice(0, 10);
      if ((await store.countIpActivations(ipHash, day)) >= ACTIVATIONS_PER_IP_DAY) {
        return fail(429, 'TOO_MANY_TRIES', 'Too many licence activations from this internet connection today. Try again tomorrow, or reply to your purchase email.');
      }
      await store.addIpActivation(ipHash, day);
    }
  }

  const active = (await store.devices(license.id)).filter((d) => !d.deactivated_at);
  const mine = hasDevice ? active.find((d) => d.device_hash === device) : undefined;

  if (action === 'devices') {
    return { status: 200, json: { ok: true, plan: license.plan, hint: license.key_hint, devices: deviceList(active), maxDevices: license.max_devices } };
  }

  if (action === 'deactivate') {
    const target = body.deviceId ? active.find((d) => d.id === body.deviceId) : mine;
    if (!target) return fail(404, 'NO_DEVICE', 'That device is already off your license.');
    const since = new Date(now - 30 * DAY).toISOString();
    if ((await store.countEvents(license.id, 'deactivate', since)) >= DEACTIVATIONS_PER_30_DAYS) {
      return fail(429, 'TOO_MANY_CHANGES', `This key has had ${DEACTIVATIONS_PER_30_DAYS} devices removed in the last 30 days. Reply to your purchase email and we'll sort it out.`);
    }
    await store.deactivateDevice(target.id);
    await store.logEvent(license.id, 'deactivate', { device: target.device_hash.slice(0, 12), name: target.device_name });
    return { status: 200, json: { ok: true, devices: deviceList(active.filter((d) => d.id !== target.id)), maxDevices: license.max_devices } };
  }

  if (mine) {
    await store.touchDevice(mine.id, meta);
  } else if (action === 'refresh') {
    return fail(403, 'NOT_ACTIVATED', 'This laptop is no longer on your license. Add your key again to use 4ruple here.');
  } else if (active.length >= license.max_devices) {
    return fail(409, 'DEVICE_LIMIT', `Your key is already in use on ${license.max_devices} devices. Remove one to use it here.`, {
      devices: deviceList(active),
      maxDevices: license.max_devices,
    });
  } else {
    await store.upsertDevice(license.id, { device_hash: device, ...meta });
    await store.logEvent(license.id, 'activate', { device: device.slice(0, 12), name: meta.device_name });
  }

  const token = await signPass(
    { v: 1, lid: license.id, dev: device, plan: license.plan, hint: license.key_hint, iat: now, exp: now + TOKEN_DAYS * DAY },
    privateKey,
  );
  return {
    status: 200,
    json: {
      ok: true,
      token,
      license: {
        plan: license.plan,
        hint: license.key_hint,
        email: maskEmail(license.email),
        devicesUsed: mine ? active.length : active.length + 1,
        maxDevices: license.max_devices,
      },
    },
  };
}

/**
 * Is this payment big enough to be a licence sale? The floor is in paise, so it only applies to rupees:
 * a US$100 payment arrives as 10000 cents and must not be mistaken for a tiny rupee payment.
 */
export function paymentQualifies({ currency, amount, minPaise = 200000 }) {
  const value = Number(amount);
  if (!Number.isFinite(value) || value <= 0) return false;
  return String(currency || 'INR').toUpperCase() === 'INR' ? value >= Number(minPaise) : true;
}

/**
 * Creates the license for a paid order. Safe to call again for the same order, because payment webhooks retry.
 * The stored hash can't give a key back, so a retry that comes before the email went out gets a fresh key.
 * store: findLicenseByOrder(orderRef), createLicense(row), updateLicense(id, patch), logEvent(...)
 */
export async function issueLicense(
  { email, orderRef = null, provider = 'manual', amountPaise = null, plan = 'lifetime', maxDevices = DEFAULT_MAX_DEVICES, quantity = 1 },
  { store },
) {
  const clean = String(email || '').trim().toLowerCase();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(clean)) throw new Error('A valid buyer email is needed');
  const seats = Math.min(Math.max(Math.round(Number(quantity)) || 1, 1), 20);

  // A pack is one purchase and several keys, one per person, each with its own devices.
  const results = [];
  for (let seat = 1; seat <= seats; seat++) {
    const ref = orderRef ? (seats > 1 ? `${orderRef}#${seat}` : orderRef) : null;
    const existing = ref ? await store.findLicenseByOrder(ref) : null;
    if (existing?.email_sent_at) {
      results.push({ license: existing, key: null, duplicate: true });
      continue;
    }
    const key = newLicenseKey();
    const secret = { key_hash: await keyHash(key), key_hint: keyHint(key) };
    const license = existing
      ? await store.updateLicense(existing.id, secret)
      : await store.createLicense({
          ...secret,
          email: clean,
          plan,
          max_devices: maxDevices,
          order_ref: ref,
          provider,
          amount_paise: seat === 1 ? amountPaise : null,
          status: 'active',
        });
    await store.logEvent(license.id, existing ? 'reissue' : 'issue', { provider, orderRef: ref, seat, seats });
    results.push({ license, key, duplicate: false });
  }

  const first = results[0];
  return {
    ...first,
    seats,
    licenses: results.map((r) => r.license),
    keys: results.map((r) => r.key),
    // A pack only counts as already handled when every key in it went out.
    duplicate: results.every((r) => r.duplicate),
  };
}
