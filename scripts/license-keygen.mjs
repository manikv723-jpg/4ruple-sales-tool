// Makes the Ed25519 key pair that signs license passes. Run once:
//   node scripts/license-keygen.mjs
// The private key becomes the LICENSE_SIGNING_JWK secret in Supabase and never ships in the app.
// The public key goes into lib/license.js (PUBLIC_KEY), so the app can check passes offline.
// Making a new pair later logs everyone out at their next check, so keep .license-keys/ backed up.
import fs from 'node:fs';
import path from 'node:path';
import { b64url } from '../lib/license-core.js';

const dir = path.join(import.meta.dirname, '..', '.license-keys');
const privateFile = path.join(dir, 'signing-private.jwk.json');
if (fs.existsSync(privateFile) && !process.argv.includes('--force')) {
  console.error(`A key pair already exists in ${dir}. Use --force to replace it (this invalidates every pass).`);
  process.exit(1);
}

const pair = await crypto.subtle.generateKey({ name: 'Ed25519' }, true, ['sign', 'verify']);
const privateJwk = await crypto.subtle.exportKey('jwk', pair.privateKey);
const publicRaw = b64url(await crypto.subtle.exportKey('raw', pair.publicKey));

fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
fs.writeFileSync(privateFile, JSON.stringify(privateJwk), { mode: 0o600 });
fs.writeFileSync(path.join(dir, 'public-key.txt'), `${publicRaw}\n`);

console.log(`Private key: ${privateFile}`);
console.log('  Set it in Supabase: supabase secrets set LICENSE_SIGNING_JWK="$(cat .license-keys/signing-private.jwk.json)"');
console.log(`Public key:  ${publicRaw}`);
console.log('  It goes in lib/license.js as PUBLIC_KEY.');
