// Issues licences by hand, for UPI or bank-transfer sales, packs and free copies:
//   FOURUPLE_ISSUE_URL=https://<project-ref>.supabase.co/functions/v1/issue-license \
//   FOURUPLE_ADMIN_TOKEN=<LICENSE_ADMIN_TOKEN> \
//   node scripts/issue-license.mjs buyer@example.com "upi:ref-123" 2
// The last number is how many keys (one per person); leave it out for one.
// Prints the keys. They are also emailed to the buyer once email is set up in Supabase.
const [email, orderRef, quantity] = process.argv.slice(2);
const url = process.env.FOURUPLE_ISSUE_URL;
const token = process.env.FOURUPLE_ADMIN_TOKEN;
if (!email || !url || !token) {
  console.error('Usage: FOURUPLE_ISSUE_URL=... FOURUPLE_ADMIN_TOKEN=... node scripts/issue-license.mjs <buyer email> [order ref]');
  process.exit(1);
}

const res = await fetch(url, {
  method: 'POST',
  headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
  body: JSON.stringify({ email, orderRef: orderRef || null, quantity: Number(quantity) || 1 }),
});
const out = await res.json().catch(() => ({ error: `HTTP ${res.status}` }));
if (!out.ok) {
  console.error(`Couldn't issue: ${out.error || res.status}`);
  process.exit(1);
}
if (out.duplicate) console.log(`That order already has its licences (keys ending ${(out.hints || []).join(', ')}), and the email went out.`);
else console.log(`${out.keys.length > 1 ? `Keys for ${email}, one per person:\n  ` : `Key for ${email}: `}${out.keys.join('\n  ')}\n${out.emailed ? 'Emailed to the buyer.' : 'Not emailed (email is not set up): send them yourself.'}`);
