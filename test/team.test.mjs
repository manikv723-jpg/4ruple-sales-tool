// Team rules: creating and joining, invite codes, one owner per person, who sees what, and the sync that
// keeps two laptops from emailing the same person.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { memoryStore } from '../scripts/memory-store.mjs';
import { handleTeamRequest, normalizeTeamCode, totalsFrom, FEED_DAYS } from '../lib/team-core.js';
import { issueLicense } from '../lib/license-core.js';

const ROOT = path.resolve(import.meta.dirname, '..');
const DAY = 86_400_000;
const store = memoryStore();
const device = (name) => createHash('sha256').update(`device-${name}`).digest('hex');
const ask = (body) => handleTeamRequest(body, { store });

const boss = (await issueLicense({ email: 'boss@example.com', orderRef: 'o1' }, { store })).key;
const junior = (await issueLicense({ email: 'junior@example.com', orderRef: 'o2' }, { store })).key;
const outsider = (await issueLicense({ email: 'outsider@example.com', orderRef: 'o3' }, { store })).key;
const lead = (email, extra = {}) => ({ ref: `lead-${email}`, email, fullName: 'A Person', company: 'Tidewater Coffee', status: 'new', updatedAt: Date.now(), ...extra });

test('the Supabase copy of the team rules matches the app copy', () => {
  const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');
  assert.equal(read('supabase/functions/_shared/team-core.js'), read('lib/team-core.js'));
});

test('team codes survive being pasted badly', () => {
  assert.equal(normalizeTeamCode('4t-abcd-2345'.toUpperCase().toLowerCase()), '4T-ABCD-2345');
  assert.equal(normalizeTeamCode(' abcd 2345 '), '4T-ABCD-2345');
  assert.equal(normalizeTeamCode('4T-OOOO-IIII'), '4T-0000-1111');
  assert.equal(normalizeTeamCode('4T-ABC'), null);
});

test('the owner creates a team, invites once, and the junior joins with the code', async () => {
  assert.equal((await ask({ action: 'status', key: boss, device: device('boss') })).json.code, 'NO_TEAM');

  const created = await ask({ action: 'create', key: boss, device: device('boss'), teamName: 'Northlight', memberName: 'Aisha' });
  assert.equal(created.status, 200);
  assert.equal(created.json.me.role, 'owner');

  assert.equal((await ask({ action: 'invite', key: junior, device: device('junior') })).json.code, 'NO_TEAM');
  const invited = await ask({ action: 'invite', key: boss, device: device('boss') });
  assert.match(invited.json.code, /^4T(-[0-9A-HJKMNP-TV-Z]{4}){2}$/);

  const joined = await ask({ action: 'join', key: junior, device: device('junior'), code: invited.json.code.toLowerCase(), memberName: 'Dev' });
  assert.equal(joined.status, 200);
  assert.equal(joined.json.me.role, 'member');
  assert.deepEqual(joined.json.members.map((m) => m.name), ['Aisha', 'Dev']);

  // One invite, one person. A second person needs a new code.
  const reuse = await ask({ action: 'join', key: outsider, device: device('outsider'), code: invited.json.code, memberName: 'Sam' });
  assert.equal(reuse.json.code, 'CODE_USED');
  assert.equal((await ask({ action: 'join', key: junior, device: device('junior'), code: invited.json.code })).json.code, 'ALREADY_IN_TEAM');
  assert.equal((await ask({ action: 'join', key: outsider, device: device('outsider'), code: '4T-ZZZZ-ZZZZ' })).json.code, 'INVALID_CODE');
});

test('an expired code is refused', async () => {
  const invite = await ask({ action: 'invite', key: boss, device: device('boss') });
  store.tables.invites.at(-1).expires_at = new Date(Date.now() - DAY).toISOString();
  assert.equal((await ask({ action: 'join', key: outsider, device: device('outsider'), code: invite.json.code })).json.code, 'CODE_EXPIRED');
});

test('two laptops never work the same person twice', async () => {
  const mine = await ask({ action: 'sync', key: junior, device: device('junior'), leads: [lead('riya@tidewater.example')], events: [] });
  assert.equal(mine.status, 200);
  assert.equal(mine.json.rejected.length, 0);

  const clash = await ask({ action: 'sync', key: boss, device: device('boss'), leads: [lead('riya@tidewater.example'), lead('sam@kindred.example')] });
  assert.deepEqual(clash.json.rejected.map((r) => r.email), ['riya@tidewater.example']);
  assert.equal(clash.json.rejected[0].reason, 'owned');
  // The one nobody had is kept.
  assert.ok(clash.json.leads.some((l) => l.email === 'sam@kindred.example'));
});

test('the owner sees the junior\'s drafts and feed, the junior sees totals only', async () => {
  const at = Date.now();
  await ask({
    action: 'sync',
    key: junior,
    device: device('junior'),
    leads: [lead('riya@tidewater.example', { status: 'to review', draft: { subject: 'After the pop-up', email1: 'Hi Riya,', followup1: '', followup2: '', deck: true } })],
    events: [
      { ref: 'e1', type: 'draft_written', at, leadEmail: 'riya@tidewater.example', leadName: 'Riya' },
      { ref: 'e2', type: 'email_sent', at, leadEmail: 'riya@tidewater.example', leadName: 'Riya' },
    ],
  });

  const owner = await ask({ action: 'sync', key: boss, device: device('boss') });
  const seen = owner.json.leads.find((l) => l.email === 'riya@tidewater.example');
  assert.equal(seen.draft.subject, 'After the pop-up');
  assert.ok(owner.json.events.some((e) => e.type === 'email_sent'));
  assert.ok(owner.json.totals.some((t) => t.sent === 1 && t.drafts === 1));

  const member = await ask({ action: 'sync', key: junior, device: device('junior') });
  assert.ok(member.json.leads.every((l) => l.ownerId === member.json.me.id), 'a member only gets their own leads');
  assert.ok(member.json.events.every((e) => e.memberId === member.json.me.id), 'a member only gets their own feed');
  assert.ok(member.json.totals.length >= 1, 'a member still sees team totals');
  assert.ok(!member.json.leads.some((l) => l.email === 'sam@kindred.example'), "the boss's own leads stay with the boss");
});

test('the same sync twice does not double count the day', async () => {
  const before = store.tables.teamEvents.length;
  const events = [{ ref: 'e1', type: 'draft_written', at: Date.now(), leadEmail: 'riya@tidewater.example' }];
  await ask({ action: 'sync', key: junior, device: device('junior'), events });
  await ask({ action: 'sync', key: junior, device: device('junior'), events });
  assert.equal(store.tables.teamEvents.length, before);
});

test('the do-not-contact list is shared with the whole team', async () => {
  await ask({ action: 'sync', key: junior, device: device('junior'), blocked: [{ value: 'nope@tidewater.example', reason: 'declined', at: Date.now() }] });
  const owner = await ask({ action: 'sync', key: boss, device: device('boss'), since: new Date(Date.now() - DAY).toISOString() });
  assert.ok(owner.json.blocked.some((b) => b.value === 'nope@tidewater.example' && b.reason === 'declined'));
});

test('only the owner invites, renames and removes, and the owner cannot walk out', async () => {
  const members = (await ask({ action: 'status', key: boss, device: device('boss') })).json.members;
  const dev = members.find((m) => m.name === 'Dev');
  assert.equal((await ask({ action: 'remove', key: junior, device: device('junior'), memberId: dev.id })).json.code, 'OWNER_ONLY');
  assert.equal((await ask({ action: 'rename', key: junior, device: device('junior'), teamName: 'Nope' })).json.code, 'OWNER_ONLY');
  assert.equal((await ask({ action: 'leave', key: boss, device: device('boss') })).json.code, 'OWNER_CANNOT_LEAVE');

  assert.equal((await ask({ action: 'rename', key: boss, device: device('boss'), teamName: 'Northlight Studio' })).json.team.name, 'Northlight Studio');
  assert.equal((await ask({ action: 'leave', key: junior, device: device('junior') })).status, 200);
  assert.equal((await ask({ action: 'status', key: junior, device: device('junior') })).json.code, 'NO_TEAM');

  // Having left, the same licence can join a new team.
  const invite = await ask({ action: 'invite', key: boss, device: device('boss') });
  assert.equal((await ask({ action: 'join', key: junior, device: device('junior'), code: invite.json.code, memberName: 'Dev' })).status, 200);
});

test('a revoked licence loses its seat, and totals only cover the recent feed', async () => {
  store.tables.licenses.find((l) => l.order_ref === 'o2').status = 'refunded';
  assert.equal((await ask({ action: 'sync', key: junior, device: device('junior') })).json.code, 'REVOKED');

  const old = new Date(Date.now() - (FEED_DAYS + 2) * DAY).toISOString();
  assert.equal(totalsFrom([{ member_id: 'm1', type: 'email_sent', at: old }]).length, 1);
  assert.equal(totalsFrom([]).length, 0);
});
