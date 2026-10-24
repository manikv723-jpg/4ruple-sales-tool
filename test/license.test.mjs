// License rules and the app's license check, run against an in-memory copy of the license service.
// npm test
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import net from 'node:net';
import path from 'node:path';
import http from 'node:http';
import { spawn } from 'node:child_process';
import { createHash, createHmac } from 'node:crypto';

const ROOT = path.resolve(import.meta.dirname, '..');
const DAY = 86_400_000;
const core = await import('../lib/license-core.js');

function memoryStore() {
  const licenses = [];
  const devices = [];
  const events = [];
  const ipHits = [];
  let n = 0;
  const id = () => `id-${++n}`;
  const stamp = () => new Date().toISOString();
  return {
    licenses,
    tables: { licenses, devices, events, ipHits },
    findLicense: async (hash) => licenses.find((l) => l.key_hash === hash) || null,
    findLicenseByOrder: async (ref) => licenses.find((l) => l.order_ref === ref) || null,
    createLicense: async (row) => { const l = { id: id(), created_at: stamp(), email_sent_at: null, ...row }; licenses.push(l); return l; },
    updateLicense: async (lid, patch) => Object.assign(licenses.find((l) => l.id === lid), patch),
    markEmailed: async (lid) => { licenses.find((l) => l.id === lid).email_sent_at = stamp(); },
    devices: async (lid) => devices.filter((d) => d.license_id === lid),
    upsertDevice: async (lid, d) => {
      const found = devices.find((x) => x.license_id === lid && x.device_hash === d.device_hash);
      if (found) Object.assign(found, d, { deactivated_at: null, last_seen_at: stamp() });
      else devices.push({ id: id(), license_id: lid, ...d, activated_at: stamp(), last_seen_at: stamp(), deactivated_at: null });
    },
    touchDevice: async (did, meta) => {
      Object.assign(devices.find((d) => d.id === did), Object.fromEntries(Object.entries(meta).filter(([, v]) => v != null)), { last_seen_at: stamp() });
    },
    deactivateDevice: async (did) => { devices.find((d) => d.id === did).deactivated_at = stamp(); },
    logEvent: async (lid, type, meta) => { events.push({ license_id: lid, type, meta, created_at: stamp() }); },
    countEvents: async (lid, type, since) => events.filter((e) => e.license_id === lid && e.type === type && e.created_at >= since).length,
    countIpActivations: async (ipHash, day) => ipHits.find((h) => h.ip_hash === ipHash && h.day === day)?.count ?? 0,
    addIpActivation: async (ipHash, day) => {
      const found = ipHits.find((h) => h.ip_hash === ipHash && h.day === day);
      if (found) found.count += 1;
      else ipHits.push({ ip_hash: ipHash, day, count: 1 });
    },
  };
}

// ---------- a local license service ----------
const pair = await crypto.subtle.generateKey({ name: 'Ed25519' }, true, ['sign', 'verify']);
const publicRaw = core.b64url(await crypto.subtle.exportKey('raw', pair.publicKey));
const verifyKey = await core.importVerifyKey(publicRaw);
const store = memoryStore();
let serviceDown = false;
const service = http.createServer(async (req, res) => {
  if (serviceDown) { res.writeHead(503); res.end('down'); return; }
  const chunks = [];
  for await (const c of req) chunks.push(c);
  const { status, json } = await core.handleLicenseRequest(JSON.parse(Buffer.concat(chunks)), { store, privateKey: pair.privateKey });
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(json));
});
await new Promise((resolve) => service.listen(0, '127.0.0.1', resolve));

const DATA = fs.mkdtempSync(path.join(os.tmpdir(), '4ruple-license-test-'));
Object.assign(process.env, {
  FOURUPLE_DATA_DIR: DATA,
  FOURUPLE_REQUIRE_LICENSE: '1',
  FOURUPLE_LICENSE_API: `http://127.0.0.1:${service.address().port}/license`,
  FOURUPLE_LICENSE_PUBLIC_KEY: publicRaw,
});
const app = await import('../lib/license.js');
const LICENSE_FILE = path.join(DATA, 'license.json');

const BUYER = 'buyer@example.com';
const newKey = async (opts = {}) => (await core.issueLicense({ email: BUYER, ...opts }, { store })).key;
const otherDevice = (n) => createHash('sha256').update(`other-laptop-${n}`).digest('hex');
const fromService = (body, ip = null) => core.handleLicenseRequest({ email: BUYER, ...body }, { store, privateKey: pair.privateKey, ip });
const check = () => { app.forgetLicenseCheck(); return app.licenseStatus(); };
const saved = () => JSON.parse(fs.readFileSync(LICENSE_FILE, 'utf8'));
const offline = async (fn) => { serviceDown = true; try { return await fn(); } finally { serviceDown = false; } };

test.after(() => {
  service.close();
  fs.rmSync(DATA, { recursive: true, force: true });
});

// ---------- rules ----------
test('the Supabase copy of the license rules matches the app copy', () => {
  const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');
  assert.equal(read('supabase/functions/_shared/license-core.js'), read('lib/license-core.js'));
});

test('keys survive being pasted badly', () => {
  const key = core.newLicenseKey();
  assert.match(key, /^4R(-[0-9A-HJKMNP-TV-Z]{5}){4}$/);
  assert.equal(core.normalizeKey(key.toLowerCase().replace(/-/g, ' ')), key);
  assert.equal(core.normalizeKey(` ${key.slice(3)}\n`), key);
  assert.equal(core.normalizeKey('4R-00000-11111-22222-O0O0O'), '4R-00000-11111-22222-00000');
  assert.equal(core.normalizeKey('4R-AAAAA-BBBBB'), null);
});

test('a pass that was changed is rejected', async () => {
  const token = await core.signPass({ v: 1, exp: 1 }, pair.privateKey);
  assert.deepEqual(await core.readPass(token, verifyKey), { v: 1, exp: 1 });
  const forged = core.b64url(new TextEncoder().encode(JSON.stringify({ v: 1, exp: 9e15 })));
  assert.equal(await core.readPass(`${forged}.${token.split('.')[1]}`, verifyKey), null);
  assert.equal(await core.readPass('garbage', verifyKey), null);
});

test('Razorpay signatures match an HMAC of the raw body', async () => {
  const body = JSON.stringify({ event: 'payment.captured', payload: {} });
  const sig = await core.hmacSha256Hex('webhook-secret', body);
  assert.equal(sig, createHmac('sha256', 'webhook-secret').update(body).digest('hex'));
  assert.equal(core.sameText(sig, sig), true);
  assert.equal(core.sameText(sig, 'f'.repeat(64)), false);
  assert.equal(core.sameText('', ''), false);
});

test('Dodo (Standard Webhooks) signatures are checked, including age and rotation', async () => {
  const secretBytes = crypto.getRandomValues(new Uint8Array(24));
  const secret = `whsec_${Buffer.from(secretBytes).toString('base64')}`;
  const body = JSON.stringify({ type: 'payment.succeeded', data: { payment_id: 'pay_1' } });
  const id = 'msg_1';
  const ts = String(Math.floor(Date.now() / 1000));
  const sig = createHmac('sha256', Buffer.from(secretBytes)).update(`${id}.${ts}.${body}`).digest('base64');
  const headers = (s, t = ts) => ({ 'webhook-id': id, 'webhook-timestamp': t, 'webhook-signature': s });
  assert.equal(await core.standardWebhookValid(secret, headers(`v1,${sig}`), body), true);
  assert.equal(await core.standardWebhookValid(secret, headers(`v1,old-signature v1,${sig}`), body), true);
  assert.equal(await core.standardWebhookValid(secret, headers(`v1,${sig}`), `${body} `), false);
  assert.equal(await core.standardWebhookValid(secret, headers(`v1,${sig}`, String(Number(ts) - 3600)), body), false);
  assert.equal(await core.standardWebhookValid('', headers(`v1,${sig}`), body), false);
});

test('the amount floor is in rupees, so a dollar payment is not mistaken for a small one', () => {
  const minPaise = 200000; // ₹2,000
  assert.equal(core.paymentQualifies({ currency: 'INR', amount: 999900, minPaise }), true);
  assert.equal(core.paymentQualifies({ currency: 'INR', amount: 100, minPaise }), false);
  // US$100 arrives as 10000 cents: it must still issue a licence.
  assert.equal(core.paymentQualifies({ currency: 'USD', amount: 10000, minPaise }), true);
  assert.equal(core.paymentQualifies({ currency: 'usd', amount: 0, minPaise }), false);
  assert.equal(core.paymentQualifies({ currency: 'INR', amount: undefined, minPaise }), false);
});

test('issuing is safe to repeat for the same payment', async () => {
  const first = await core.issueLicense({ email: ' Buyer@Example.com ', orderRef: 'razorpay:pay_1' }, { store });
  assert.equal(first.license.email, 'buyer@example.com');
  // The email hadn't gone out yet, so a webhook retry gets a fresh key and the first one stops working.
  const retry = await core.issueLicense({ email: 'buyer@example.com', orderRef: 'razorpay:pay_1' }, { store });
  assert.notEqual(retry.key, first.key);
  assert.equal(await store.findLicense(await core.keyHash(first.key)), null);
  await store.markEmailed(retry.license.id);
  const again = await core.issueLicense({ email: 'buyer@example.com', orderRef: 'razorpay:pay_1' }, { store });
  assert.equal(again.duplicate, true);
  assert.equal(again.key, null);
  assert.equal(store.licenses.filter((l) => l.order_ref === 'razorpay:pay_1').length, 1);
  await assert.rejects(core.issueLicense({ email: 'not-an-email' }, { store }));
});

// ---------- the app's check ----------
test('with no key the app asks for one', async () => {
  const s = await check();
  assert.equal(s.ok, false);
  assert.equal(s.code, 'NO_KEY');
});

test('a mistyped or unknown key is refused', async () => {
  assert.equal((await app.activateLicense('hello', BUYER)).code, 'INVALID_KEY');
  assert.equal((await app.activateLicense(core.newLicenseKey(), BUYER)).code, 'INVALID_KEY');
});

test('a key only activates with the email it was bought with', async () => {
  const key = await newKey();
  assert.equal((await app.activateLicense(key, '')).code, 'EMAIL_NEEDED');
  assert.equal((await app.activateLicense(key, 'someone@else.example')).code, 'EMAIL_MISMATCH');
  const ok = await app.activateLicense(key, ` ${BUYER.toUpperCase()} `);
  assert.equal(ok.ok, true, ok.error);
});

test('one internet connection can only activate so many keys a day', async () => {
  const key = await newKey({ maxDevices: 20 });
  const ip = '203.0.113.9';
  for (let n = 0; n < core.ACTIVATIONS_PER_IP_DAY; n++) {
    const r = await fromService({ action: 'activate', key, device: otherDevice(500 + n) }, ip);
    assert.equal(r.status, 200, r.json.error);
  }
  const blocked = await fromService({ action: 'activate', key, device: otherDevice(900) }, ip);
  assert.equal(blocked.status, 429);
  assert.equal(blocked.json.code, 'TOO_MANY_TRIES');
  // A different connection is unaffected, and the hashed address is what gets stored.
  assert.equal((await fromService({ action: 'activate', key, device: otherDevice(500) }, '198.51.100.4')).status, 200);
  assert.ok(store.tables.ipHits.every((h) => h.ip_hash.length === 64));
});

test('a two-key pack is one purchase and two keys', async () => {
  const pack = await core.issueLicense({ email: BUYER, orderRef: 'dodo:pack_1', quantity: 2, plan: 'team2' }, { store });
  assert.equal(pack.seats, 2);
  // A pack is several keys, each on its own laptop, not several laptops on one key.
  assert.deepEqual(pack.licenses.map((l) => l.max_devices), [core.DEFAULT_MAX_DEVICES, core.DEFAULT_MAX_DEVICES]);
  assert.equal(core.DEFAULT_MAX_DEVICES, 1);
  assert.equal(pack.keys.filter(Boolean).length, 2);
  assert.notEqual(pack.keys[0], pack.keys[1]);
  assert.deepEqual(pack.licenses.map((l) => l.order_ref), ['dodo:pack_1#1', 'dodo:pack_1#2']);
  for (const key of pack.keys) assert.ok(await store.findLicense(await core.keyHash(key)));
  for (const licence of pack.licenses) await store.markEmailed(licence.id);
  const retry = await core.issueLicense({ email: BUYER, orderRef: 'dodo:pack_1', quantity: 2 }, { store });
  assert.equal(retry.duplicate, true);
  assert.equal(store.tables.licenses.filter((l) => String(l.order_ref).startsWith('dodo:pack_1')).length, 2);
});

test('a real key activates this laptop and keeps working offline', async () => {
  const key = await newKey({ maxDevices: 2 });
  const r = await app.activateLicense(key.toLowerCase(), BUYER);
  assert.equal(r.ok, true, r.error);
  assert.equal(r.devicesUsed, 1);
  assert.equal(r.maxDevices, 2);
  assert.equal(saved().key, key);
  assert.equal((await offline(check)).ok, true);
});

test('a third device is stopped until one is removed', async () => {
  const key = await newKey({ maxDevices: 2 });
  for (const n of [1, 2]) assert.equal((await fromService({ action: 'activate', key, device: otherDevice(n), name: `Laptop ${n}` })).status, 200);
  const blocked = await app.activateLicense(key, BUYER);
  assert.equal(blocked.code, 'DEVICE_LIMIT');
  assert.deepEqual(blocked.devices.map((d) => d.name), ['Laptop 1', 'Laptop 2']);
  const removed = await app.removeDevice(key, blocked.devices[0].id);
  assert.equal(removed.ok, true, removed.error);
  const r = await app.activateLicense(key, BUYER);
  assert.equal(r.ok, true, r.error);
  assert.equal(r.devicesUsed, 2);
});

test('an expired pass refreshes, and offline grace ends after 7 more days', async () => {
  const key = await newKey();
  await app.activateLicense(key, BUYER);
  const base = saved();
  const pass = await core.readPass(base.token, verifyKey);
  const writePass = async (exp) => {
    const token = await core.signPass({ ...pass, iat: exp - 7 * DAY, exp }, pair.privateKey);
    fs.writeFileSync(LICENSE_FILE, JSON.stringify({ ...base, token }));
  };

  await writePass(Date.now() - DAY);
  const refreshed = await check();
  assert.equal(refreshed.ok, true);
  assert.ok(refreshed.validUntil > Date.now() + 6 * DAY);

  await writePass(Date.now() - 2 * DAY);
  const grace = await offline(check);
  assert.equal(grace.ok, true);
  assert.equal(grace.offline, true);

  await writePass(Date.now() - 8 * DAY);
  const locked = await offline(check);
  assert.equal(locked.ok, false);
  assert.equal(locked.code, 'OFFLINE');
});

test('a refunded license locks the app at its next check', async () => {
  const key = await newKey();
  await app.activateLicense(key, BUYER);
  (await store.findLicense(await core.keyHash(key))).status = 'refunded';
  fs.writeFileSync(LICENSE_FILE, JSON.stringify({ ...saved(), token: 'expired.pass' }));
  const s = await check();
  assert.equal(s.ok, false);
  assert.equal(s.code, 'REVOKED');
});

test('a license file copied from another laptop does not work here', async () => {
  const key = await newKey();
  const elsewhere = await fromService({ action: 'activate', key, device: otherDevice(5) });
  fs.writeFileSync(LICENSE_FILE, JSON.stringify({ key, token: elsewhere.json.token, license: elsewhere.json.license }));
  const s = await check();
  assert.equal(s.ok, false);
  assert.equal(s.code, 'NOT_ACTIVATED');
});

test('taking this laptop off the license frees its slot', async () => {
  const key = await newKey({ maxDevices: 1 });
  await app.activateLicense(key, BUYER);
  assert.deepEqual(await app.deactivateThisDevice(), { ok: true, removed: true });
  assert.equal(fs.existsSync(LICENSE_FILE), false);
  assert.equal((await fromService({ action: 'activate', key, device: otherDevice(7) })).status, 200);
});

test('removing devices is limited to 5 in 30 days', async () => {
  const key = await newKey({ maxDevices: 1 });
  for (let n = 0; n < 5; n++) {
    assert.equal((await fromService({ action: 'activate', key, device: otherDevice(100 + n) })).status, 200);
    assert.equal((await fromService({ action: 'deactivate', key, device: otherDevice(100 + n) })).status, 200);
  }
  await fromService({ action: 'activate', key, device: otherDevice(200) });
  const sixth = await fromService({ action: 'deactivate', key, device: otherDevice(200) });
  assert.equal(sixth.status, 429);
  assert.equal(sixth.json.code, 'TOO_MANY_CHANGES');
});

test('with no key the app stays locked, and a bought key opens it', async () => {
  fs.rmSync(LICENSE_FILE, { force: true });
  const locked = await check();
  assert.equal(locked.ok, false);
  assert.equal(locked.code, 'NO_KEY');

  const bought = await app.activateLicense(await newKey(), BUYER);
  assert.equal(bought.ok, true, bought.error);
  assert.equal(bought.plan, 'lifetime');
  assert.equal((await check()).ok, true);
});

test('with only the key, the manage page lists devices and frees a seat', async () => {
  const key = await newKey();
  await fromService({ action: 'activate', key, device: otherDevice(300), name: 'Work laptop' });
  const list = await fromService({ action: 'devices', key });
  assert.equal(list.status, 200);
  assert.deepEqual(list.json.devices.map((d) => d.name), ['Work laptop']);
  const freed = await fromService({ action: 'deactivate', key, deviceId: list.json.devices[0].id });
  assert.equal(freed.status, 200);
  assert.equal(freed.json.devices.length, 0);
  assert.equal((await fromService({ action: 'devices', key: core.newLicenseKey() })).json.code, 'INVALID_KEY');
  assert.equal((await fromService({ action: 'refresh', key })).json.code, 'BAD_REQUEST');
});

// ---------- the server ----------
const freePort = () => new Promise((resolve) => {
  const s = net.createServer().listen(0, '127.0.0.1', () => { const { port } = s.address(); s.close(() => resolve(port)); });
});

test('the installed app keeps its API locked until a key is added, and only answers this laptop', async () => {
  const port = await freePort();
  const base = `http://127.0.0.1:${port}`;
  const child = spawn(process.execPath, [path.join(ROOT, 'server.js')], {
    env: { ...process.env, PORT: String(port), FOURUPLE_DATA_DIR: fs.mkdtempSync(path.join(os.tmpdir(), '4ruple-server-test-')) },
    stdio: 'ignore',
  });
  try {
    for (let i = 0; i < 60; i++) {
      try { if ((await fetch(`${base}/api/health`)).ok) break; } catch { /* starting */ }
      await new Promise((r) => setTimeout(r, 150));
    }
    assert.equal((await (await fetch(`${base}/api/health`)).json()).app, '4ruple');

    const locked = await fetch(`${base}/api/state`);
    assert.equal(locked.status, 402);
    assert.equal((await locked.json()).license.code, 'NO_KEY');
    assert.equal((await fetch(`${base}/`)).status, 200);

    const post = (url, body, headers = {}) => fetch(`${base}${url}`, { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body) });
    assert.equal((await post('/api/license/activate', {}, { Origin: 'https://evil.example' })).status, 403);
    const rebound = await new Promise((resolve) => {
      http.get({ host: '127.0.0.1', port, path: '/api/health', headers: { Host: 'evil.example' } }, (res) => { res.resume(); resolve(res.statusCode); });
    });
    assert.equal(rebound, 403);

    const activated = await (await post('/api/license/activate', { key: await newKey(), email: BUYER })).json();
    assert.equal(activated.ok, true, activated.error);
    assert.equal((await fetch(`${base}/api/state`)).status, 200);
  } finally {
    child.kill();
  }
});
