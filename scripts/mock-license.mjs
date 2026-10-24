// Local stand-in for the Supabase functions, signed with the real key pair, for demos and end-to-end checks.
// Never deploy this: it keeps everything in memory and trusts every caller.
//   node scripts/mock-license.mjs <port> <out.json>     (used by scripts/demo.sh)
// POST /license       same actions as supabase/functions/license (trial, activate, refresh, deactivate, devices)
// POST /team          same actions as supabase/functions/team (create, join, invite, sync, ...)
// POST /issue         {email} -> {ok, key}: stands in for the payment webhook
// POST /expire-trials ends every trial, to see the "trial has ended" screen
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { memoryStore } from './memory-store.mjs';

const ROOT = path.resolve(import.meta.dirname, '..');
const [port = '4700', outFile] = process.argv.slice(2);
const core = await import(`${ROOT}/lib/license-core.js`);
const teamCore = await import(`${ROOT}/lib/team-core.js`);
const privateKey = await core.importSigningKey(fs.readFileSync(`${ROOT}/.license-keys/signing-private.jwk.json`, 'utf8'));
const store = memoryStore();

const { key } = await core.issueLicense({ email: 'aisha@northlight.example', orderRef: 'demo-1' }, { store });
const { key: fullKey } = await core.issueLicense({ email: 'aisha@northlight.example', orderRef: 'demo-2' }, { store });
const { key: ownerKey } = await core.issueLicense({ email: 'boss@northlight.example', orderRef: 'demo-owner' }, { store });
const { key: memberKey } = await core.issueLicense({ email: 'junior@northlight.example', orderRef: 'demo-member' }, { store });
for (const [i, name, platform] of [[1, 'Studio iMac', 'darwin-arm64'], [2, 'Old MacBook Air', 'darwin-x64']]) {
  await core.handleLicenseRequest({ action: 'activate', key: fullKey, device: createHash('sha256').update(`demo-${i}`).digest('hex'), name, platform }, { store, privateKey });
}

const send = (res, status, json) => { res.writeHead(status, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(json)); };

http.createServer(async (req, res) => {
  const chunks = [];
  for await (const c of req) chunks.push(c);
  let body = {};
  try { body = JSON.parse(Buffer.concat(chunks).toString() || '{}'); } catch { return send(res, 400, { ok: false, error: 'Send JSON' }); }

  if (req.url.startsWith('/issue')) {
    try {
      const r = await core.issueLicense({ email: body.email, orderRef: `demo:${Date.now()}`, provider: 'demo', amountPaise: 249900 }, { store });
      console.log(`[mock] issue ${body.email} -> ${r.key.slice(0, 8)}…`);
      return send(res, 200, { ok: true, key: r.key });
    } catch (e) {
      return send(res, 400, { ok: false, error: e.message });
    }
  }
  if (req.url.startsWith('/team')) {
    const { status, json } = await teamCore.handleTeamRequest(body, { store });
    console.log(`[mock] team ${body.action} -> ${status} ${json.code || ''}`);
    return send(res, status, json);
  }

  const { status, json } = await core.handleLicenseRequest(body, { store, privateKey, ip: req.socket.remoteAddress });
  console.log(`[mock] ${body.action} -> ${status} ${json.code || ''}`);
  send(res, status, json);
}).listen(Number(port), '127.0.0.1', () => {
  const base = `http://127.0.0.1:${port}`;
  const info = { api: `${base}/license`, team: `${base}/team`, issue: `${base}/issue`, key, fullKey, ownerKey, memberKey };
  if (outFile) fs.writeFileSync(outFile, JSON.stringify(info));
  console.log(JSON.stringify(info));
});
