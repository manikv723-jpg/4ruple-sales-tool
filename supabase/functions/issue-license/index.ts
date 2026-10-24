// Issues 4ruple licenses.
//   Razorpay webhook: send only the "payment.captured" and "refund.processed" events here, with
//   RAZORPAY_WEBHOOK_SECRET set. Each captured payment of at least LICENSE_MIN_PAISE gets one license,
//   emailed to the buyer. A refund marks the license refunded, which locks the app at its next check.
//   Manual (UPI, bank transfer, comps): POST {"email", "orderRef"} with "Authorization: Bearer <LICENSE_ADMIN_TOKEN>".
//   The key comes back in the response too, so you can send it yourself if email isn't set up yet.
// Email goes out through Resend when RESEND_API_KEY and LICENSE_EMAIL_FROM are set.
import { createClient } from 'npm:@supabase/supabase-js@2';
import { issueLicense, hmacSha256Hex, sameText, standardWebhookValid, paymentQualifies } from '../_shared/license-core.js';
import { supabaseStore } from '../_shared/supabase-store.js';

const env = (name: string) => Deno.env.get(name) ?? '';
const store = supabaseStore(createClient(env('SUPABASE_URL'), env('SUPABASE_SERVICE_ROLE_KEY'), { auth: { persistSession: false } }));
const MIN_PAISE = Number(env('LICENSE_MIN_PAISE') || 200000);
const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

function keyEmail(keys: string[]) {
  const many = keys.length > 1;
  const steps = [
    'Install Node.js 22 (nodejs.org) and Google Chrome, if they are not on your laptop yet.',
    'Install Claude Code and sign in: npm install -g @anthropic-ai/claude-code, then claude auth login.',
    'Open Terminal and run: npx 4ruple',
    '4ruple opens in your browser. Paste your key when it asks.',
  ];
  const text = [
    'Thanks for buying 4ruple.ai.',
    '',
    many ? `Your ${keys.length} licence keys, one per person:` : 'Your licence key:',
    ...keys.map((k) => `  ${k}`),
    '',
    ...steps.map((s, i) => `${i + 1}. ${s}`),
    '',
    'Activating asks for this email address, so keep it to hand.',
    many
      ? 'Give one key to each person. Each key runs on one laptop at a time, and they can work as a team inside the app.'
      : 'Your key runs on one laptop at a time. To move it, run npx 4ruple deactivate on the old one, or use the manage page.',
    "Keep this email. For security, we can't show the keys again, but we can issue new ones if you reply here.",
  ].join('\n');
  const html = `<div style="font-family:system-ui,sans-serif;font-size:15px;line-height:1.6;color:#1A1916;max-width:560px">
<p>Thanks for buying <b>4ruple.ai</b>.</p>
<p>${many ? `Your ${keys.length} licence keys, one per person` : 'Your licence key'}</p>
${keys.map((k) => `<p style="font-family:ui-monospace,Menlo,monospace;font-size:18px;background:#F6F5F2;border:1px solid #E8E6E1;border-radius:8px;padding:12px 16px">${k}</p>`).join('')}
<ol>${steps.map((s) => `<li>${s.replace('npx 4ruple', '<code>npx 4ruple</code>')}</li>`).join('')}</ol>
<p style="color:#5F5B53">Activating asks for this email address, so keep it to hand. ${many ? 'Give one key to each person. Each key runs on one laptop at a time, and they can work as a team inside the app.' : 'Your key runs on one laptop at a time. To move it, run <code>npx 4ruple deactivate</code> on the old one, or use the manage page.'} Keep this email: for security we can't show the keys again, but we can issue new ones if you reply here.</p>
</div>`;
  return { text, html };
}

async function emailKey(to: string, keys: string[]) {
  if (!env('RESEND_API_KEY') || !env('LICENSE_EMAIL_FROM')) {
    console.warn('[issue-license] email is not set up, keys not sent');
    return false;
  }
  const { text, html } = keyEmail(keys);
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${env('RESEND_API_KEY')}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      from: env('LICENSE_EMAIL_FROM'),
      to: [to],
      ...(env('LICENSE_REPLY_TO') && { reply_to: env('LICENSE_REPLY_TO') }),
      subject: keys.length > 1 ? `Your ${keys.length} 4ruple.ai licence keys` : 'Your 4ruple.ai licence key',
      text,
      html,
    }),
  });
  if (!res.ok) console.error('[issue-license] email failed', res.status, await res.text());
  return res.ok;
}

async function issueAndEmail(input: { email: string; orderRef: string | null; provider: string; amountPaise: number | null; maxDevices?: number; quantity?: number; plan?: string }) {
  const { licenses, keys, duplicate } = await issueLicense(input, { store });
  if (duplicate) return { duplicate: true, emailed: true, hints: licenses.map((l) => l.key_hint), keys: [] };
  const emailed = await emailKey(licenses[0].email, keys.filter(Boolean) as string[]);
  if (emailed) for (const licence of licenses) await store.markEmailed(licence.id);
  return { duplicate: false, emailed, hints: licenses.map((l) => l.key_hint), keys };
}

Deno.serve(async (req) => {
  if (req.method !== 'POST') return json(405, { ok: false, error: 'Use POST' });
  const raw = await req.text();

  // Manual issuing
  const admin = env('LICENSE_ADMIN_TOKEN');
  const auth = req.headers.get('authorization') || '';
  if (auth.startsWith('Bearer ') && !req.headers.get('x-razorpay-signature')) {
    if (!admin || !sameText(auth.slice(7), admin)) return json(401, { ok: false, error: 'Wrong admin token' });
    try {
      const body = JSON.parse(raw);

      // A refunded payment switches its keys off. A pack shares one payment, so every key it issued goes.
      if (body.action === 'revoke') {
        const base = String(body.orderRef || '').trim();
        if (!base) return json(400, { ok: false, error: 'orderRef is needed' });
        const refs = [base, ...Array.from({ length: 20 }, (_, i) => `${base}#${i + 1}`)];
        let revoked = 0;
        for (const ref of refs) {
          const licence = await store.findLicenseByOrder(ref);
          if (!licence) continue;
          await store.updateLicense(licence.id, { status: 'refunded' });
          await store.logEvent(licence.id, 'refund', { orderRef: ref });
          revoked += 1;
        }
        return json(200, { ok: true, revoked });
      }

      const r = await issueAndEmail({
        email: body.email,
        orderRef: body.orderRef || null,
        provider: body.provider || 'manual',
        amountPaise: body.amountPaise ?? null,
        maxDevices: body.maxDevices,
        quantity: body.quantity,
        plan: body.plan,
      });
      return json(200, { ok: true, ...r });
    } catch (e) {
      return json(400, { ok: false, error: (e as Error).message });
    }
  }

  // Dodo Payments webhook (Standard Webhooks). Subscribe to payment.succeeded and refund.succeeded,
  // and set DODO_WEBHOOK_SECRET to the endpoint's whsec_ secret.
  if (req.headers.get('webhook-signature')) {
    const headers = Object.fromEntries(['webhook-id', 'webhook-timestamp', 'webhook-signature'].map((h) => [h, req.headers.get(h)]));
    if (!(await standardWebhookValid(env('DODO_WEBHOOK_SECRET'), headers, raw))) return json(401, { ok: false, error: 'Bad signature' });
    const event = JSON.parse(raw);
    const data = event.data || {};

    if (event.type === 'refund.succeeded') {
      const license = data.payment_id && (await store.findLicenseByOrder(`dodo:${data.payment_id}`));
      if (license) {
        await store.updateLicense(license.id, { status: 'refunded' });
        await store.logEvent(license.id, 'refund', { paymentId: data.payment_id });
      }
      return json(200, { ok: true, refunded: !!license });
    }
    if (event.type !== 'payment.succeeded') return json(200, { ok: true, ignored: event.type });
    if (!paymentQualifies({ currency: data.currency, amount: data.total_amount, minPaise: MIN_PAISE })) {
      return json(200, { ok: true, ignored: 'amount' });
    }
    const email = data.customer?.email || data.metadata?.email;
    if (!email || !data.payment_id) {
      console.error('[issue-license] Dodo payment without email or id', data.payment_id);
      return json(200, { ok: true, ignored: 'no email' });
    }
    // A two-key pack arrives as a quantity, or as seats in the metadata we set on the checkout session.
    const quantity = Number(data.metadata?.seats || data.quantity || data.product_cart?.[0]?.quantity || 1);
    try {
      const r = await issueAndEmail({
        email,
        orderRef: `dodo:${data.payment_id}`,
        provider: 'dodo',
        amountPaise: data.currency === 'INR' ? Number(data.total_amount) : null,
        quantity,
        plan: quantity > 1 ? `team${quantity}` : 'lifetime',
      });
      // A non-2xx makes Dodo retry, which issues a fresh key if the first email didn't go out.
      return json(r.emailed ? 200 : 500, { ok: r.emailed, duplicate: r.duplicate });
    } catch (e) {
      console.error('[issue-license]', e);
      return json(500, { ok: false });
    }
  }

  // Razorpay webhook
  const signature = req.headers.get('x-razorpay-signature');
  if (signature) {
    const secret = env('RAZORPAY_WEBHOOK_SECRET');
    if (!secret || !sameText(await hmacSha256Hex(secret, raw), signature)) return json(401, { ok: false, error: 'Bad signature' });
    const event = JSON.parse(raw);

    if (event.event === 'refund.processed') {
      const paymentId = event.payload?.refund?.entity?.payment_id;
      const license = paymentId && (await store.findLicenseByOrder(`razorpay:${paymentId}`));
      if (license) {
        await store.updateLicense(license.id, { status: 'refunded' });
        await store.logEvent(license.id, 'refund', { paymentId });
      }
      return json(200, { ok: true, refunded: !!license });
    }
    // Standard Checkout with an order fires both; whichever lands first issues, the other is a duplicate.
    if (!['payment.captured', 'order.paid'].includes(event.event)) return json(200, { ok: true, ignored: event.event });

    const payment = event.payload?.payment?.entity;
    if (!payment || !paymentQualifies({ currency: payment.currency, amount: payment.amount, minPaise: MIN_PAISE })) {
      return json(200, { ok: true, ignored: 'amount' });
    }
    // Razorpay puts void@razorpay.com when the checkout didn't ask for an email.
    const email = [payment.email, payment.notes?.email].find((e) => e && e !== 'void@razorpay.com');
    if (!email) {
      console.error('[issue-license] captured payment has no buyer email', payment.id);
      return json(200, { ok: true, ignored: 'no email' });
    }
    const seats = Number(payment.notes?.seats || 1);
    try {
      const r = await issueAndEmail({
        email,
        orderRef: `razorpay:${payment.id}`,
        provider: 'razorpay',
        amountPaise: payment.currency === 'INR' ? payment.amount : null,
        quantity: seats,
        plan: seats > 1 ? `team${seats}` : 'lifetime',
      });
      // A 500 makes Razorpay retry, which issues a fresh key if the first email didn't go out.
      return json(r.emailed ? 200 : 500, { ok: r.emailed, duplicate: r.duplicate });
    } catch (e) {
      console.error('[issue-license]', e);
      return json(500, { ok: false });
    }
  }

  return json(400, { ok: false, error: 'Unrecognised request' });
});
