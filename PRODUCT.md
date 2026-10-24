# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

B2B services firms: any services company with a small sales team that sells to other businesses, not only creative agencies. The person at the keyboard is the founder or salesperson doing outbound. They know which companies they want to work with, but they don't have time to find the right people, research each one, write a personal pitch and chase follow-ups.

## Product Purpose

4ruple.ai makes a sales team more efficient: it takes a services firm from "companies we want to work with" to replies and meetings. The user describes their business and portfolio once and lists target companies (or uploads a list). The tool then:

- finds the right people and their emails
- researches each prospect
- writes a personal email sequence and a 4-page pitch deck for every lead
- lets the user review and approve each one
- sends from the user's own Gmail and runs the follow-ups
- reads replies and marks each lead interested or not, with a next step

Success means personal, approved outreach goes out with little effort, and the replies turn into conversations.

## Positioning

An all-in-one outbound pipeline. The stated end goal (source doc "v0 of Sales tool") is one platform that replaces Apollo (lead data), Instantly and Lemlist (sequences), Calendly (booking), a calling agent and a lead manager board. Customers choose it so they stop stitching five tools together. The per-lead research, emails and brand-matched decks are how the pipeline works today, not the headline claim.

## Operating Context

- The customer flow has four steps: **You** (business profile), **Leads** (find or upload people), **Review** (check and approve each email and deck), **Send** (sequence and replies). Operator setup (lead-source keys, Gmail connection, test timing) sits apart in Settings.
- Emails send from the customer's own Gmail inbox. Follow-ups thread under the first email and stop when the person replies.
- Leads come from a lead search (Prospeo, with Hunter as fallback) or a CSV such as an Apollo export.
- Each lead takes about 2 to 3 minutes of research and writing before it can be reviewed.
- Review is per person: the user edits copy directly, or types a change request and the email and deck are rewritten.
- **How it reaches customers (16 Sep 2026):** the app is installed on the customer's own Mac with `npx 4ruple`. It writes with the customer's own Claude Code sign-in, so there is no AI cost to us and no API key to hand out. There is no free trial: a one-time licence key opens the app and runs on one laptop at a time. Activation asks for the key and the email it was bought with, and activations are capped per internet connection per day.
- **Teams:** each teammate buys their own licence and runs their own copy. The owner creates a team and invites with a code. Leads, drafts, activity and the do-not-contact list sync so the owner can see the day's work and two people never email the same person. The owner reads everyone's drafts; a member sees their own work plus team totals. Gmail details, lead-search keys and deck files never sync.

## Capabilities and Constraints

- v0 ships as a local app the customer runs on their own Mac (`npx 4ruple`, http://localhost:4600), not as a hosted service. There are no accounts and no sign-in anywhere: a licence key, kept on the laptop, is the only identity. A hosted version stays possible later, but the AI cost is why this one runs on the customer's own Claude plan.
- Needs on the customer's Mac: Node 22, Google Chrome (for deck PDFs), Claude Code signed in with a paid Claude plan, and a Gmail app password. Windows and Linux are untested and must not be promised.
- The v0 interface must already look and behave like the final product. It is not a throwaway prototype look; the final version gets a fuller UI/UX on the same footing.
- Built today: profile with portfolio auto-read; lead search and CSV upload; per-lead research, subject line, email, two follow-ups and a 4-page PDF deck in the prospect's brand colours; revisions from comments; approval; Gmail sending; scheduled follow-ups; reply detection marked Interested or Not interested with a next step; Preview mode that sends everything to the user's own inbox first.
- Built since: the `npx` installer and its checks, licence keys (one laptop at a time, self-service device moves), teams with owner visibility, and a product page with checkout, thank-you and manage pages on basementprotocol.com.
- Not built yet (part of the end goal): booking beyond a link, calling agent, lead manager board, escalating CTAs, LinkedIn drafts, campaigns, multi-sender.
- Apollo and Clay data can't be resold inside the product (Apollo's API terms are internal use only).
- Sending through Gmail OAuth needs Google's app review, so v0 connects Gmail with an app password.
- Customer-facing copy says "people" for leads and uses "Preview mode", "Interested" and "Not interested".
- Pricing, live on basementprotocol.com/4ruple (16 Sep 2026): a one-time lifetime licence, **₹9,999 in India or US$100 internationally, for 1 device**, with engineer-led setup and a 7-day refund. Razorpay Standard Checkout is live with real keys. A two-person pack (one purchase, two keys) and an enterprise tier are built in the licence service but not yet on the page; a 50% launch discount would be a Razorpay coupon at checkout. Lead data is not resold: customers bring their own Apollo, Prospeo or Hunter key, or a CSV. The earlier "₹999 per 100 leads" idea is retired, because the AI cost per lead made it lose money; the customer's own Claude plan pays for the writing instead.
- Open decisions: the final price; which payment company takes the money; whether the app moves to the dark, dense look of the Sales CRM the owner admired (sales-crm-kargulstudio.vercel.app) or keeps the light Clay and Bitscale world and borrows its table, filters and side panel.

## Brand Commitments

- Name: **4ruple.ai** (reads as "quadruple"; short form 4R). Written exactly as `4ruple.ai`, lowercase after the numeral. "4Rappel.ai" was considered and rejected.
- Tagline: **"Crack revenue 4x faster"**. The 4x is the brand promise the name carries, not a measured benchmark: never restate it as a statistic, a chart, or a number with a source.
- Family: 4ruple.ai is part of **Basement Protocol** (the owner's AI-services company, basementprotocol.com). Endorsed brand: "4ruple.ai by Basement Protocol". It inherits Basement Protocol's logo grammar (square geometry, nested steps, one blue `#4D7CFF` square), Geist and Geist Mono, and the blue accent. The 4ruple.ai mark is "Fourth Step": the parent's stepped mark with a fourth step (see `.impeccable/research/03-basement-brand.md`).
- Standing visual preference (15 Sep 2026, owner's words: "do something like clay, bitscale"): the app should sit alongside **Clay** and **Bitscale**, light warm-neutral workspace, white rounded panels, spreadsheet-style tables, soft pastel status chips, black pill primary buttons, blue selection. Their craft level is the bar.
- Voice: plain, crisp, confident words a first-time customer understands. No em dashes in any customer-facing copy.
- Must not feel: like a generic AI SaaS product, playful or cartoonish, stiff and corporate, or hyped with fake proof.
- Customers never see internal mechanics: API keys, credits, data vendors, model names, or "hot/cold" labels. Those stay in operator settings or out of the UI entirely.

## Evidence on Hand

- No customers, testimonials, case studies, usage numbers or logos exist. Future work must not invent any.
- `data/db.json` holds test data only: a "Northlight Studio (TEST)" profile and a test lead at Mamaearth with a generated email and deck.
- Requirements source: the Google Doc "v0 of Sales tool".

## Product Principles

1. **One pipeline, not five tools.** Finding people, writing, approving, sending and reading replies happen in one continuous flow.
2. **The customer stays in control.** Nothing sends until they approve it, and Preview mode is on by default.
3. **Plain language over plumbing.** Customers see people, emails, decks and replies, never the vendors or models behind them.
4. **Personal at scale, never invented.** Every lead gets real research, and every claim about the sender comes from their own profile.
5. **v0 is the product.** Every screen is built to the standard of the final tool.
