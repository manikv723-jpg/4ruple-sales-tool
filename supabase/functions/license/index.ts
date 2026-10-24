// The license check the installed app calls: activate a key on a device, refresh its pass, or remove a device.
// Secrets: LICENSE_SIGNING_JWK (private key from scripts/license-keygen.mjs). SUPABASE_URL and
// SUPABASE_SERVICE_ROLE_KEY are provided by Supabase. Deploy with JWT checks off (see supabase/config.toml).
import { createClient } from 'npm:@supabase/supabase-js@2';
import { handleLicenseRequest, importSigningKey } from '../_shared/license-core.js';
import { supabaseStore } from '../_shared/supabase-store.js';

const store = supabaseStore(
  createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false } }),
);
const privateKey = await importSigningKey(Deno.env.get('LICENSE_SIGNING_JWK')!);

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

Deno.serve(async (req) => {
  if (req.method !== 'POST') return json(405, { ok: false, code: 'BAD_REQUEST', error: 'Use POST' });
  let body;
  try {
    body = await req.json();
  } catch {
    return json(400, { ok: false, code: 'BAD_REQUEST', error: 'Send JSON' });
  }
  // The caller's address, only ever stored as a hash, to limit activations and spot a shared key.
  const ip = (req.headers.get('x-forwarded-for') || '').split(',')[0].trim() || null;
  try {
    const { status, json: out } = await handleLicenseRequest(body, { store, privateKey, ip });
    return json(status, out);
  } catch (e) {
    console.error('[license]', e);
    return json(500, { ok: false, code: 'SERVER', error: 'The license service hit a problem. Try again in a minute.' });
  }
});
