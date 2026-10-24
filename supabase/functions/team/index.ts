// The team service the app syncs with: create or join a team, invite, and push and pull leads, drafts,
// activity and the shared do-not-contact list. Every call carries a licence key and a device id; the licence
// has to be active. Deploy with JWT checks off (see supabase/config.toml).
import { createClient } from 'npm:@supabase/supabase-js@2';
import { handleTeamRequest } from '../_shared/team-core.js';
import { supabaseStore } from '../_shared/supabase-store.js';
import { supabaseTeamStore } from '../_shared/supabase-team-store.js';

const sb = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false } });
const store = { ...supabaseStore(sb), ...supabaseTeamStore(sb) };

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
  const ip = (req.headers.get('x-forwarded-for') || '').split(',')[0].trim() || null;
  try {
    const { status, json: out } = await handleTeamRequest(body, { store, ip });
    return json(status, out);
  } catch (e) {
    console.error('[team]', e);
    return json(500, { ok: false, code: 'SERVER', error: 'The team service hit a problem. Your work is saved on your laptop; it will sync when this clears.' });
  }
});
