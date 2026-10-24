# 4ruple.ai: everything the website needs

Handoff for whoever builds the product page, the post-payment page and the licence management page.
Written 16 Sep 2026. The app and the licence service already exist and work; this document is the contract between them and the website.

---

## 1. What is being sold

**4ruple.ai by Basement Protocol.** A sales outreach app that runs on the buyer's own Mac. It finds people at their target companies, writes a personal email, two follow-ups and a 4-page deck for each one, and sends them from the buyer's own Gmail after they approve.

- **Price ladder (16 Sep 2026).** Put all three in `lib/business.ts` as the single source of truth:
  - **One person: ₹9,999**, one key, one laptop at a time.
  - **Two people: ₹14,999**, one purchase that emails **two keys**, one per person, one laptop each. They can work as a team in the app.
  - **More than two people: enterprise, custom.** No price on the page: a "Talk to us" button that opens the existing enquiry dialog with the product set to 4ruple.
- **Launch discount:** 50% off, given as a **discount code entered at checkout**, using the payment provider's own coupon feature. Do not build our own code system, and do not show a struck-through price unless you also show the code.
- **Includes:** updates to version 0.x, key emailed right after payment.
- **No free trial.** The key is the only way into the app. Never write "try it free" anywhere.
- **Refund:** within 7 days if the key has not been activated on more than one device. A refund switches the key off.
- **Nothing to download.** There is no installer and no .dmg. The app is started with one command: `npx 4ruple`.

The buyer never creates an account with us. There is no login, no dashboard and no password anywhere in this product.

---

## 2. The journey the website has to support

1. Visitor reads `/4ruple` and buys: one person, two people, or an enterprise enquiry.
2. They pay through the payment provider's checkout on the page, entering the launch code if they have it.
3. The checkout must collect the buyer's email: the key is emailed there, and **activation later asks for that same address**.
4. The provider calls our `issue-license` function, which creates a key and emails it (see section 6).
5. They land on `/4ruple/thanks`: "your key is on its way to <email>", plus the three install steps.
6. They run `npx 4ruple` and paste the key when the app asks.
7. Later, to move laptops, they use `/4ruple/manage` with just the key, or run `npx 4ruple deactivate` on the old one.

---

## 3. Installation copy for the website

This is the accurate, ready-to-use version. Keep the order: what they need, then the one command, then what happens on first run.

### Before you start
- **A Mac.** Windows and Linux are untested for now, so say exactly that; don't promise them.
- **Node.js 22 or later,** from nodejs.org. (The app needs 20.11 at minimum, but tell people 22.)
- **Google Chrome.** The app uses it to turn each deck into a PDF. Chromium or Edge also work if Chrome isn't installed.
- **Claude Code, signed in with a paid Claude plan.** Every email and deck is written by the buyer's own Claude Code, so there is no per-email AI fee from us, and the writing counts toward their plan's usage limits.
  - Install: `npm install -g @anthropic-ai/claude-code`
  - Sign in: `claude auth login`
- **A Gmail account with 2-step verification and an app password** (myaccount.google.com/apppasswords). Emails are sent from that account.
- **Optional, to find people:** an Apollo, Prospeo or Hunter key. Prospeo and Hunter have free plans, Apollo uses the credits on the buyer's own Apollo plan. Without any of these they can still upload a CSV.

### The command
```
npx 4ruple
```
It checks the laptop, starts 4ruple and opens it in the browser. The Terminal window has to stay open while they use it; Ctrl+C stops it. Running it again later is the same command. To update: `npx 4ruple@latest`.

### On first run
1. The checks print, each as a tick or a cross with the fix beside it.
2. The browser opens at `http://localhost:4600`.
3. The app asks for the licence key **and the email it was bought with**. Both are in the purchase email.
4. Then: Your firm → Leads → Review → Outreach.

### All commands worth listing
| Command | What it does |
| --- | --- |
| `npx 4ruple` | check the laptop, start the app, open it |
| `npx 4ruple doctor` | only run the checks |
| `npx 4ruple deactivate` | take this laptop off the licence, freeing a seat |
| `npx 4ruple --port 4700` | use another port |
| `npx 4ruple --no-open` | don't open the browser |

### What the checks say when something is missing
Mirror these on a troubleshooting section, in the same words the app uses:
- **Node too old:** "Install Node.js 22 from nodejs.org, then run npx 4ruple again."
- **Chrome missing:** "Install it from google.com/chrome, or set CHROME_BIN to where Chrome is."
- **Claude Code missing:** "Install it: npm install -g @anthropic-ai/claude-code, then sign in: claude auth login"
- **Claude Code not signed in:** "Sign in: claude auth login, then run npx 4ruple again."
- **Gmail app password wrong:** Google app passwords are 16 letters, not the account password, and 2-step verification has to be on first.

### Where the buyer's data lives
Everything stays on their laptop in `~/.4ruple`: firm profile, leads, drafts, decks, Gmail app password and lead-search keys. Deleting that folder removes it all. We never receive leads, emails or decks.

### What we do receive
The licence check sends: the key, a one-way hash of the device id, the device name (the computer's name), the platform (for example `darwin-arm64`) and the app version. The privacy page must say this, because the manage page shows those device names back to the buyer.

---

## 4. Licence rules the copy must match

- A key looks like `4R-XXXXX-XXXXX-XXXXX-XXXXX`. It is emailed once; we store only a hash, so we cannot show it again, but we can issue a new one.
- **A key only activates with the email it was sold to**, and one internet connection can activate at most 20 keys a day. Both facts belong in the FAQ: "Use the address you bought with" and "bought for a colleague? Buy the two-person pack, or send us their address."
- One key runs on **one laptop at a time**, matching what the live page sells. Moving to another laptop is `npx 4ruple deactivate`, or freeing the seat on the manage page. A second laptop is refused with a list of what is in use and the option to free it. (The code takes a device count per licence, so a different number can be sold later without a rebuild.)
- The app checks the key online about once a week and keeps working offline in between, plus 7 days of grace if the check can't be reached.
- Removing devices is limited to 5 in 30 days, to stop a key being passed around.
- A refund sets the licence to refunded, and the app locks at its next check.

---

## 5. Licence API (for the manage page)

One HTTPS endpoint, the Supabase edge function `license`:
```
POST https://<project-ref>.supabase.co/functions/v1/license
Content-Type: application/json
```
No auth header. **Call it from the server, never from the browser**, so the site can rate limit it (the current build proxies it at `/api/4ruple/license` and allows only the two actions below, 30 requests per 10 minutes per IP).

### List the devices on a key
```json
{ "action": "devices", "key": "4R-XXXXX-XXXXX-XXXXX-XXXXX" }
```
```json
{ "ok": true, "plan": "lifetime", "hint": "MT6B7",
  "devices": [{ "id": "uuid", "name": "MacBook-Pro", "platform": "darwin-arm64", "lastSeen": "2026-09-15T18:18:47.113Z" }],
  "maxDevices": 2 }
```

### Free a seat
```json
{ "action": "deactivate", "key": "4R-…", "deviceId": "uuid" }
```
Answers `{ "ok": true, "devices": [...], "maxDevices": 2 }` with the remaining devices.

### Failures
Always `{ "ok": false, "code": "...", "error": "..." }`. **Show `error` to the customer as it is**; those strings are written for them. Codes: `INVALID_KEY` (400/404), `REVOKED` (403, refunded or switched off), `NO_DEVICE` (404, already removed), `TOO_MANY_CHANGES` (429, the 5-in-30-days limit), `BAD_REQUEST` (400).

Keys may be pasted in lowercase, with spaces, or with O instead of 0. The service normalises them, so pass through whatever the customer typed.

Page requirements: `noindex`, no account, a "Forgot your key? Reply to your purchase email" line, and a summary like "1 of 1 device in use". Platform strings map to plain words: `darwin` = Mac, `win32` = Windows, `linux` = Linux.

---

## 6. Payment to key (what happens after checkout)

The payment provider must call our function, which is already built:
```
POST https://<project-ref>.supabase.co/functions/v1/issue-license
```
**What is live today (16 Sep 2026):** Razorpay Standard Checkout on the site, with `/api/create-order` and `/api/verify-payment`. Verifying a payment signature is not delivery. The delivery path is `/api/4ruple/razorpay-webhook` on the site, which checks Razorpay's signature, looks up the buyer's email from the stored order, and calls the Supabase `issue-license` function with the admin token. It answers 500 when it cannot issue, so Razorpay retries rather than losing a paid sale.

It verifies the signature, creates the licence and emails the key through Resend. It handles:
- **Dodo Payments:** events `payment.succeeded` and `refund.succeeded`, Standard Webhooks signature (`webhook-id`, `webhook-timestamp`, `webhook-signature`), secret in `DODO_WEBHOOK_SECRET`.
- **Razorpay:** events `payment.captured` and `refund.processed`, `X-Razorpay-Signature`, secret in `RAZORPAY_WEBHOOK_SECRET`.
- **Manual sales (UPI, bank transfer, comps):** `Authorization: Bearer <LICENSE_ADMIN_TOKEN>` with `{"email": "...", "orderRef": "...", "quantity": 1}`, which returns the keys in the response. Script: `scripts/issue-license.mjs`.
- **Refunds:** the same admin token with `{"action": "revoke", "orderRef": "razorpay:pay_xxx"}` switches off every key that payment issued.

Rules the provider setup has to respect:
- **The buyer's email must be collected at checkout.** It is how the key reaches them and what they type to activate. (Razorpay sends `void@razorpay.com` when the field is missing; that payment issues no key.)
- **Packs:** for the two-person product, the number of keys comes from the payment. With Dodo, set `metadata.seats = 2` on the checkout session (quantity also works); with Razorpay, set `notes.seats = 2`. The function then issues two keys and emails both in one message.
- Repeat calls for the same payment are safe: the licence is keyed on the payment id. If the first email never went out, a retry issues a fresh key and retires the old one.
- A non-2xx answer means the provider should retry, which is deliberate: it covers a failed email.
- **The key must never pass through the browser.** The thank-you page says "check your email"; it does not display the key. (The demo build shows a key only because there is no real payment or email in demo mode.)
- If you use **Paddle** instead, its event is `transaction.completed` and the signature is `Paddle-Signature` over `ts:rawBody`; that adapter is not written yet, so say the word and it takes a few lines.

---

## 7. Environment variables

**Website (Vercel):**
- `FOURUPLE_LICENSE_API` = the `license` function URL (server-side only, for the manage page)
- `NEXT_PUBLIC_CHECKOUT_PROVIDER` = `dodo` | `razorpay` | `paddle` | `demo` (read at build time)
- provider keys, server-side only, for example `DODO_API_KEY` and `DODO_PRODUCT_ID`
- `FOURUPLE_DEMO_ISSUE_URL`, local demo only, never set in production

**Supabase (secrets):**
- `LICENSE_SIGNING_JWK` (signs the passes; the private half lives in `.license-keys/`, back it up)
- `LICENSE_ADMIN_TOKEN` (manual issuing)
- `LICENSE_MIN_PAISE` (default 200000, ignores small or test payments)
- `RESEND_API_KEY`, `LICENSE_EMAIL_FROM`, `LICENSE_REPLY_TO` (the key email)
- the provider's webhook secret, as in section 6

---

## 8. What the pages must contain

**`/4ruple`**
- Hero: what it does in one sentence, and one primary action, "Buy a licence, ₹9,999". No trial wording anywhere.
- How it works: Your firm → Leads → Review → Outreach.
- Runs on your laptop: the `npx 4ruple` command in a copyable block, data stays local, written by the buyer's own Claude Code.
- Before you buy: the requirements list from section 3.
- Price block: three columns, one person ₹9,999, two people ₹14,999 (two keys), enterprise custom. Each says what it includes: one laptop at a time, updates to 0.x, key emailed after payment, refund within 7 days, launch code accepted at checkout.
- FAQ: API key (no), where data lives, how many devices, will it send without me (no, Preview mode first), refunds, Windows (untested), why activation asks for my email, how teams work (one key per person, the owner invites inside the app).

**`/4ruple/thanks`** (`noindex`): "your key is on its way to <email>", the three install steps with the copyable command, a link to the manage page, and "Didn't get the email? Check spam, then write to <contact email> from the address you bought with."

**`/4ruple/manage`** (`noindex`): section 5.

**Legal pages required by payment providers:** Terms, Privacy, Refund policy, Contact, and a visible price. These exist; the placeholders in `lib/business.ts` (registered address, phone, grievance officer, jurisdiction city, tax note, refund processing days) still need real values.

---

## 8b. Teams (new, and it changes the privacy copy)

Two or more people can work as a team. **Each person buys their own licence**, so a boss and one junior is two purchases; one licence is one seat. Nothing about pricing changes.

- The owner creates the team inside the app and invites with a code that works once and expires in 7 days.
- Everyone's leads, **drafts**, activity and do-not-contact list sync to our service so the owner can see the day's work, and so two teammates never email the same person.
- The owner can read every teammate's leads and drafts. A member sees their own work plus team totals.
- Still never leaves the laptop, team or not: Gmail app password, lead-search API keys, deck PDFs.

**The privacy page must change for this.** The current "nothing leaves your Mac" line is only true for someone working alone. Say it in two parts: solo, nothing but the licence check leaves the laptop; on a team, the leads, drafts and activity of each teammate are stored on our service and visible to the team owner. The product page can say teams are supported; it does not need to sell them.

Nothing on the website has to be built for teams: joining, inviting and leaving all happen inside the app. A short FAQ answer is enough ("Can my team use one account?" → no accounts, one licence per person, the owner invites with a code inside the app).

## 9. Claims to avoid

- Don't say Anthropic endorses, partners with or powers this. "Works with your Claude Code" is accurate; "Claude and Claude Code are products of Anthropic. 4ruple.ai is not affiliated with Anthropic" is the safe line.
- Don't promise Windows or Linux support.
- Don't invent customer counts, testimonials, logos or results. "Crack revenue 4x faster" is a brand promise and must never be presented as a measured statistic.
- Don't say "no AI costs": say the writing uses the buyer's own Claude plan and counts toward its limits.
- Don't claim instant delivery beyond what is true: the key email usually arrives within a minute, and the fallback is replying to the purchase email.

---

## 10. What already exists in the current site build

If you keep the current Next.js site rather than rebuilding: `app/4ruple/page.tsx`, `components/basement/fouruple.tsx`, `lib/fouruple-content.ts`, `app/fouruple.css`, `lib/business.ts`, `lib/checkout.ts` (provider seam with `openCheckout`, demo provider only), `components/basement/checkout.tsx`, `app/4ruple/thanks/page.tsx`, `app/4ruple/manage/page.tsx`, `app/api/4ruple/license/route.ts`, plus the legal pages. Original versions of every edited file are in `_backup-4ruple-20260915/`.

Run the whole journey locally with fake money: `~/Documents/SalesTool-v0/scripts/demo.sh`, then buy at `http://localhost:4620/4ruple` and paste the key into the app at `http://localhost:4630`.
