# Launching 4ruple: license service, payments, npm

Written 15 Sep 2026. Policies and fees change, so check each provider's page as you go.

The flow once it's live:
buyer clicks Buy on basementprotocol.com/4ruple and pays in a checkout overlay on the page (launch code optional) → the payment provider calls the `issue-license` function → it creates a key in Supabase and emails it → buyer pastes the key into the app (one laptop at a time) → moves devices later at basementprotocol.com/4ruple/manage with just the key.

Do the steps in order. Each ends with a check.

---

## 1. Supabase license service (about 20 minutes)

1. Create a project at https://supabase.com/dashboard. Pick the Mumbai region (closest to Indian buyers). Note the **project ref**: the `xxxx` in `https://xxxx.supabase.co`.
2. Install the CLI and connect it, from this repo:
   ```sh
   brew install supabase/tap/supabase
   supabase login
   supabase link --project-ref <project-ref>
   ```
3. Create the tables:
   ```sh
   supabase db push
   ```
4. Set the secrets. The signing key was already made with `npm run keygen` and lives in `.license-keys/` (back that folder up somewhere safe; losing it means making a new pair and shipping a new app version).
   ```sh
   supabase secrets set LICENSE_SIGNING_JWK="$(cat .license-keys/signing-private.jwk.json)"
   supabase secrets set LICENSE_ADMIN_TOKEN="$(openssl rand -hex 32)"
   supabase secrets set LICENSE_MIN_PAISE=200000
   ```
   Save the admin token in your password manager: it lets you issue keys by hand.
5. Deploy both functions (`supabase/config.toml` turns off the Supabase login check for them; they check keys and signatures themselves):
   ```sh
   supabase functions deploy license
   supabase functions deploy issue-license
   supabase functions deploy team
   ```
   `supabase db push` in step 3 creates the team tables too. The team function needs no extra secrets: it checks the licence key on every call.
6. Point the app at it: in `lib/license.js`, replace `REPLACE-WITH-PROJECT-REF` with your project ref.
7. **Check:** issue yourself a key and activate it.
   ```sh
   FOURUPLE_ISSUE_URL=https://<project-ref>.supabase.co/functions/v1/issue-license \
   FOURUPLE_ADMIN_TOKEN=<admin token> \
   node scripts/issue-license.mjs you@example.com test-1
   ```
   Then run `node bin/4ruple.js` from the repo, paste the key, and look at the `license_overview` view in the Supabase table editor: one license, one device.

## 2. Email the keys (about 30 minutes, mostly waiting for DNS)

1. Create an account at https://resend.com and add the domain `basementprotocol.com`.
2. Resend shows DNS records (SPF/DKIM). The domain's DNS is at GoDaddy: add them there, then press Verify in Resend.
3. Create an API key in Resend, then:
   ```sh
   supabase secrets set RESEND_API_KEY=<key>
   supabase secrets set LICENSE_EMAIL_FROM="4ruple.ai <licenses@basementprotocol.com>"
   supabase secrets set LICENSE_REPLY_TO=<the inbox you read>
   ```
4. **Check:** run the `issue-license.mjs` command again with a new order ref. The key should arrive by email.

Until email is set up, manual issuing still prints the key so you can send it yourself.

## 3. Dodo Payments (recommended): Flit-style overlay checkout, no registration

Why Dodo first: it accepts individuals with a PAN (verification in 24-72 working hours), shows UPI and Indian cards in INR, opens as an overlay on your own page like Flit's Paddle checkout, and acts as merchant of record, so it applies the tax. Fees about 4% + 15¢. Payouts are in USD (no INR wallet), $50 minimum.
Sources, checked 15 Sep 2026: https://docs.dodopayments.com/miscellaneous/faq, https://docs.dodopayments.com/developer-resources/overlay-checkout, https://dodopayments.com/pricing

Before you build on it, ask Dodo support in writing:
- whether 4ruple fits their rules (it helps users send outbound sales email; Paddle, for example, bans "mass marketing" products);
- how GST works when an Indian seller sells to Indian buyers through them.
Reviews mention long balance holds, so withdraw often.

Steps:
1. Sign up at https://app.dodopayments.com as an individual with your PAN and bank details. Have the 4ruple page and the Terms, Privacy, Refund and Contact pages live first.
2. In **Test mode**, create two products, both one-time and in INR, with Dodo's own licence keys left **off** (our Supabase service issues keys):
   - "4ruple.ai licence, one person" at ₹9,999.
   - "4ruple.ai licence, two people" at ₹14,999. The checkout session for this one must carry `metadata.seats = 2`, which is what makes the webhook issue two keys in one email.
   Then create a **50% discount code** for the launch and give it to buyers; Dodo applies it at checkout.
3. Create an API key (Test mode) and note the product id.
4. Webhooks → add endpoint `https://<project-ref>.supabase.co/functions/v1/issue-license`, events **payment.succeeded** and **refund.succeeded**. Copy its secret (starts `whsec_`):
   ```sh
   supabase secrets set DODO_WEBHOOK_SECRET=whsec_...
   supabase functions deploy issue-license
   ```
5. On the Basement Protocol site (Vercel env): `NEXT_PUBLIC_CHECKOUT_PROVIDER=dodo`, `DODO_API_KEY`, `DODO_PRODUCT_ID`, and `FOURUPLE_LICENSE_API` (the `license` function URL, for the manage page). The site creates a checkout session on the server and opens it in the overlay; the Dodo request fields come from their docs as of 15 Sep 2026, so the test purchase below is the real check.
6. **Check:** buy in Test mode. The key email arrives, `license_overview` shows provider `dodo`, the key activates in the app. Refund it: the license shows `refunded`.
7. After Dodo approves the live account, repeat 3-5 with live keys and a live webhook secret.

The demo checkout (`NEXT_PUBLIC_CHECKOUT_PROVIDER=demo`, local only) runs the same journey with no money, against the local stand-in license service.

## 3b. Razorpay, which is what is actually live (16 Sep 2026)

basementprotocol.com/4ruple sells with Razorpay Standard Checkout: `/api/create-order` makes the order server-side (it checks the price for the visitor's country and stores the buyer's email against the order), Checkout collects payment, and `/api/verify-payment` checks the signature. **Verifying a signature is not delivery**, so the key has to be issued by a webhook.

Do this to make keys arrive:
1. Finish section 1 first. Without the Supabase licence service there are no valid keys at all, and the app cannot be activated by anyone.
2. In Vercel, set on the site: `FOURUPLE_ISSUE_URL` (the `issue-license` function URL), `FOURUPLE_ADMIN_TOKEN` (its `LICENSE_ADMIN_TOKEN`), `RAZORPAY_WEBHOOK_SECRET`, and `FOURUPLE_LICENSE_API` (the `license` function URL, which the manage page needs and which is currently unset in production). Redeploy.
3. In Razorpay, Account & Settings → Webhooks → add `https://basementprotocol.com/api/4ruple/razorpay-webhook` with that same secret, and tick **payment.captured**, **order.paid** and **refund.processed**.
4. **Check:** buy once for real (or in Test mode with test keys), then confirm the key email arrives, `license_overview` in Supabase shows the sale, and the key activates in the app with the same email address. Refund it and confirm the licence shows `refunded`.

Why the webhook is on our own domain rather than pointed straight at Supabase: Razorpay often reports `void@razorpay.com` as the payer's email, while our own checkout collected a real address and stored it with the order. The route reads that address, so the key reaches the person who paid.

If the webhook cannot reach the licence service it answers 500 on purpose, so Razorpay keeps retrying and no paid sale is silently lost.

Razorpay has an **Individual / Unregistered business** account type. You need your PAN, Aadhaar (it may verify through DigiLocker), and a bank account in the same name as the PAN; a name mismatch is the most common reason KYC stalls.
Source: https://razorpay.com/docs/payments/business-types-kyc-documents/?preferred-country=IN

Fees on 15 Sep 2026: 2% on UPI and Indian cards plus 18% GST on the fee, so about ₹59 on a ₹2,499 sale, paid out the next working day. New accounts may get a 0% fee offer; a small KYC fee may apply. International cards need PayPal added for individual accounts.
Source: https://razorpay.com/pricing/

### 3a. Before you apply
KYC reviewers open your website. Have these live on basementprotocol.com first:
- the 4ruple page with the price
- Terms, Privacy, Refund policy and Contact pages, with a real contact email

(These pages are being built into the Basement Protocol site; confirm the placeholders in its `lib/business.ts` before publishing.)

### 3b. Apply
1. Sign up at https://dashboard.razorpay.com with the email and phone you'll use for the business.
2. Business type: **Individual** (or "Unregistered"). Don't choose Proprietorship: it asks for business registration documents.
3. Business category: software / SaaS. Describe it as "one-time license for 4ruple.ai, a desktop sales outreach app".
4. Website: `https://basementprotocol.com/4ruple`.
5. Add PAN, Aadhaar and bank details, and submit.
6. While KYC is in review you can build and test everything in **Test mode**.

### 3c. Payment Page (no code)
1. Dashboard → Payment Pages → Create. Title "4ruple.ai license".
2. One fixed-amount item: ₹2,499 (or your final price).
3. Customer details: make **Email** required (the key is sent there); add Name and Phone.
4. After payment: "Your license key is on its way to your email. It usually arrives within a minute."
5. Publish it and copy the link.

### 3d. Webhook
1. Dashboard → Account & Settings → Webhooks → Add new webhook.
2. URL: `https://<project-ref>.supabase.co/functions/v1/issue-license`
3. Secret: make one with `openssl rand -hex 32`, paste it here, then:
   ```sh
   supabase secrets set RAZORPAY_WEBHOOK_SECRET=<secret>
   ```
4. Active events: **payment.captured** and **refund.processed** only.
5. Test mode and Live mode have separate webhooks and secrets; repeat this in Live mode after activation and set the live secret.

### 3e. Test, then go live
1. In Test mode, open the Payment Page and pay with a Razorpay test card or test UPI id from https://razorpay.com/docs/payments/payments/test-card-details/
2. **Check:** the key email arrives, `license_overview` shows provider `razorpay`, and the key activates in the app.
3. Refund that test payment in the dashboard. **Check:** the license shows `refunded`, and the app locks within a week (at once if you delete `~/.4ruple/data/license.json` on the test laptop).
4. When KYC is approved, switch to Live, redo 3d with the live secret, and put the live Payment Page link into the Basement Protocol site as `CHECKOUT_URL`.

### While KYC is pending
Take UPI to your own account for the first few sales and issue keys by hand with `scripts/issue-license.mjs` (use the UPI reference as the order ref). Fine for a handful of buyers; it doesn't scale and there's no automatic refund.

### Backup: Dodo Payments
Dodo (an Indian merchant of record) accepts individuals with a PAN, takes UPI and Indian cards in INR and handles international buyers' taxes, for higher fees (about 4% + 15¢), with payouts in USD. Worth applying the same day as a fallback and for international sales. It would need its own small webhook handler in `issue-license`.
Source: https://docs.dodopayments.com/miscellaneous/faq

## 4. Publish on npm (10 minutes)

1. Create an account at https://www.npmjs.com (use the Basement Protocol email) and turn on 2FA.
2. From this repo:
   ```sh
   npm login
   npm test
   npm publish --dry-run     # check the file list: bin, lib, public, server.js, README only
   npm publish
   ```
   The name `4ruple` was free on 15 Sep 2026.
3. **Check:** on another laptop (or a fresh user account), run `npx 4ruple`, paste a key, and send a Preview email.

For each update: bump `version` in `package.json`, `npm test`, `npm publish`. Buyers get it with `npx 4ruple@latest`.

## 5. Tax, in short (confirm with a CA)

- Income from license sales is business income in your name until the company is registered.
- GST registration is needed once turnover passes ₹20 lakh a year, including export sales.
- Keep Razorpay's settlement reports: they're your sales record.
