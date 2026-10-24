// The intelligence layer: research the prospect, write the sequence, write the deck.
import { askClaudeJson } from './claude.js';
import { extractBrand } from './brand.js';
import { renderDeck } from './deck.js';
import { collectPortfolio, formatSources } from './sources.js';
import { roleAngle, roleBlock } from './roles.js';

const WEB_TOOLS = ['WebSearch', 'WebFetch'];

const SHAPE = `{
  "research": {
    "company_insight": "what you found about the company, 1-2 sentences",
    "person_insight": "what you found the person wrote or said, or empty string",
    "sources": ["urls you actually used"]
  },
  "hook_source": "one line: the exact thing the subject refers to and where it came from",
  "problem": "the prospect's most likely problem, one sentence",
  "hook_tier": "person, company or website. person = something this person wrote or said that you found and linked in sources; company = a specific recent company event you found and linked; website = only general facts from their site",
  "personalization_score": "a whole number from 1 to 10: person 8-10, company 5-7, website 2-4",
  "subject": "string",
  "email1": "string",
  "followup1": "string",
  "followup2": "string",
  "deck": {
    "cover": { "headline": "max 9 words", "subhead": "max 22 words" },
    "problem": { "title": "max 8 words", "points": ["max 18 words", "max 18 words", "max 18 words"], "insight": "max 25 words" },
    "solution": { "title": "max 8 words", "steps": [{ "title": "max 5 words", "detail": "max 25 words" }, { "title": "", "detail": "" }, { "title": "", "detail": "" }], "outcome": "max 20 words" },
    "work": { "title": "max 8 words", "items": [{ "client": "real client name", "what": "max 14 words", "result": "max 12 words or empty" }], "cta": "max 14 words" },
    "extra": [{ "title": "max 8 words", "body": "max 40 words", "bullets": ["max 14 words"] }]
  }
}`;

const INVISIBLE = /[\u200B-\u200D\u2060\uFEFF]/g;

// "Who do you want to reach" holds either a description or a list of company names.
export function parseIcp(icp) {
  const lines = String(icp || '').replace(INVISIBLE, '').split('\n')
    .map((l) => l.replace(/^\s*\d+\s*[.)]\s*/, '').trim()).filter(Boolean);
  const isList = lines.length >= 3 && lines.every((l) => l.length <= 40);
  return isList ? { companies: lines } : { description: lines.join(' ') };
}

function senderBlock(p) {
  const icp = parseIcp(p.icp);
  const proof = (p.proof || []).map((x) => `- ${x.client}: ${x.work}${x.result ? ` (results: ${x.result})` : ''}`).join('\n');
  return `Name: ${p.senderName || '(not given)'}
Title: ${p.senderTitle || '(not given)'}
Company: ${p.companyName || '(not given)'}
Website: ${p.website || '(not given)'}
What the firm is: ${p.firmSummary || p.about || '(not given)'}
Services: ${(p.services || []).join(', ') || '(not given)'}
Industries they've worked in: ${(p.industries || []).join(', ') || '(not given)'}
What they solve for buyers:
${p.whatYouSolve || '(not given)'}
Proof they can cite (read from their own portfolio):
${proof || '(none read yet)'}
Clients they listed themselves: ${p.notableClients || '(none)'}
Their own words about their work: ${p.brandWork || '(nothing)'}
${icp.companies ? `Companies they want to reach: ${icp.companies.join(', ')}` : `Ideal customer: ${icp.description || '(not given)'}`}
Meeting link: ${p.calendly || '(none)'}`;
}

const RULES = (p, firstName) => `## Rules
- Subject: 3 to 7 words and specific to them. Reference the person's own article or post if you found one, otherwise the specific company thing you found. No clickbait, no "quick question", no emojis.
- Email 1: 70 to 120 words. Start with "Hi ${firstName || 'there'}," then open on the specific thing, not on "I hope". Name their likely problem in one line, say how the sender solves it, then give proof by naming the sender's most relevant clients (pick work closest to this prospect's category). Mention in one short clause that a deck made for them is attached, and say how many pages it has: 4, plus one for each item in deck.extra. End with one low-friction ask${p.calendly ? ` and include this booking link: ${p.calendly}` : ''}.
- Follow-up 1: 40 to 70 words, a new angle (another proof point or one quick idea for them). It goes in the same thread, so no subject.
- Follow-up 2: 25 to 50 words, a polite close-the-loop.
- No signature or sign-off name. It's added automatically.
- Never invent facts, numbers, clients or results. Sender proof comes only from "Proof they can cite", "Clients they listed themselves" or their own words. Quote a number only if it appears in a proof item's results, and always name the client it belongs to. Prospect facts come only from your research or their website. If you found nothing specific, use something true from their website.
- Sound like a sharp human: plain words, contractions, confident, short sentences. Never use em dashes or en dashes.
- Deck copy follows the same rules. deck.work.items lists 1 to 4 pieces of real work from the sender section, chosen for relevance to this prospect; leave result empty rather than making one up.
- deck.extra is [] unless the sender asked for more pages. Each item becomes one more page after the work page, with a title, a short body and up to 3 bullets. Never add a page nobody asked for, and never more than 4.`;

const clean = (s) => String(s ?? '').replace(/\s*[—–]\s*/g, ', ').replace(/,\s*,/g, ',').trim();
const lines = (v) => (Array.isArray(v) ? v : String(v || '').split('\n')).map(clean).filter(Boolean);
const names = (v) => (Array.isArray(v) ? v : String(v || '').split(',')).map(clean).filter(Boolean);
// A result only counts when its numbers carry words. Icon-only stats (like "♡ 750K ↻ 2,652") can't be quoted honestly.
const ICON_STATS = /[^\p{L}\p{N}\s.,;:%+&'’()/-]/u;
const labelledResult = (r) => {
  const text = clean(r);
  return text && !ICON_STATS.test(text) ? text : '';
};

// How strong the opening hook is, so Review shows which drafts need a closer look. The tier is checked against
// what the research holds: a "person" hook needs something the person said, and any hook above "website" needs a source.
const HOOK_TIERS = { person: [8, 10], company: [5, 7], website: [2, 4] };

// The deck is the 4 built-in pages plus any pages the sender asked for in a comment.
export const MAX_EXTRA_PAGES = 4;
export const deckPageCount = (deck) => 4 + Math.min((deck?.extra || []).length, MAX_EXTRA_PAGES);

// The emails say how long the deck is, so "add two slides" must not leave "4-page deck" behind them.
export function syncPageCount(out) {
  if (out.deck) out.deck.extra = (Array.isArray(out.deck.extra) ? out.deck.extra : []).slice(0, MAX_EXTRA_PAGES);
  const pages = deckPageCount(out.deck);
  for (const key of ['email1', 'followup1', 'followup2']) {
    if (typeof out[key] === 'string') out[key] = out[key].replace(/\b\d+[-\s]page deck\b/gi, `${pages}-page deck`);
  }
  return pages;
}
function hookQuality(out, fallback = {}) {
  const research = out.research || {};
  let tier = String(out.hook_tier || fallback.tier || '').trim().toLowerCase();
  if (!HOOK_TIERS[tier]) tier = clean(research.person_insight) ? 'person' : clean(research.company_insight) ? 'company' : 'website';
  if (tier === 'person' && !clean(research.person_insight)) tier = 'company';
  if (tier !== 'website' && !(research.sources || []).length) tier = 'website';
  const [low, high] = HOOK_TIERS[tier];
  const n = Math.round(Number(out.personalization_score ?? fallback.score));
  return { tier, score: Number.isFinite(n) ? Math.min(Math.max(n, low), high) : low };
}

function tidy(out) {
  for (const k of ['subject', 'email1', 'followup1', 'followup2']) {
    if (typeof out[k] !== 'string' || !out[k].trim()) throw new Error(`Claude left "${k}" empty`);
    out[k] = clean(out[k]);
  }
  if (!out.deck?.cover?.headline) throw new Error('Claude returned no deck copy');
  const walk = (v) => (typeof v === 'string' ? clean(v) : Array.isArray(v) ? v.map(walk) : v && typeof v === 'object' ? Object.fromEntries(Object.entries(v).map(([k, x]) => [k, walk(x)])) : v);
  out.deck = walk(out.deck);
  return out;
}

export async function generateLead(lead, profile) {
  const brand = await extractBrand(lead.website || lead.domain, lead.logo);
  const role = roleAngle(lead.title, lead.department);
  const prompt = `You write cold outreach for a services business. Research one prospect on the web, then write a personalised 3-email sequence and the copy for a 4-page pitch deck made just for them.

## Sender (who is writing)
${senderBlock(profile)}

## Prospect
Name: ${lead.fullName || `${lead.firstName} ${lead.lastName}`}
Title: ${lead.title || '(unknown)'}
Company: ${lead.company || '(unknown)'}
Website: ${lead.website || lead.domain || '(unknown)'}
LinkedIn: ${lead.linkedin || '(unknown)'}

${roleBlock(role)}

## Their homepage (auto-extracted, may be partial)
Title: ${brand.title || '(none)'}
Description: ${brand.description || '(none)'}
Text: ${brand.text || '(could not read the site)'}

## Research (use WebSearch and WebFetch, 8 calls at most)
1. Find one specific, recent thing from the company: a launch, campaign, hiring push, funding, rebrand, new market, or a blog/press post.
2. Look for something this person wrote or said: a LinkedIn post or article, a blog post, an interview or podcast quote. Only use it if you're confident it's the same person.
3. Work out the most likely problem this company has that the sender can solve, grounded in what you found.

${RULES(profile, lead.firstName)}

Reply with ONLY this JSON, no prose before or after:
${SHAPE}`;

  const out = tidy(await askClaudeJson(prompt, { tools: WEB_TOOLS, timeoutMs: 7 * 60 * 1000 }));
  const deckPages = syncPageCount(out);
  const deckPath = await renderDeck({ lead, profile, content: out, brand });
  return {
    brand,
    deckPages,
    research: out.research || {},
    hookSource: out.hook_source || '',
    problem: out.problem || '',
    role: { key: role.key, label: role.label, level: role.level },
    hook: hookQuality(out),
    subject: out.subject,
    email1: out.email1,
    followup1: out.followup1,
    followup2: out.followup2,
    deck: out.deck,
    deckPath,
    generatedAt: Date.now(),
  };
}

export async function reviseLead(lead, profile, comment) {
  const g = lead.gen;
  const current = {
    research: g.research, hook_source: g.hookSource, problem: g.problem, hook_tier: g.hook?.tier, personalization_score: g.hook?.score,
    subject: g.subject, email1: g.email1, followup1: g.followup1, followup2: g.followup2, deck: g.deck,
  };
  const prompt = `You wrote this cold outreach (emails + deck copy) for ${lead.fullName} at ${lead.company}. The sender reviewed it and left a comment. Apply the comment exactly. Keep everything else as it is unless the comment needs it changed.

The deck is 4 fixed pages (cover, problem, solution, work) plus deck.extra. A comment asking for more slides means adding items to deck.extra, one per page, up to 4; asking for fewer means removing them. Say the new page count in the emails.

## Sender's comment
${comment}

## Sender (who is writing)
${senderBlock(profile)}

${roleBlock(roleAngle(lead.title, lead.department))}

## Current version
${JSON.stringify(current, null, 2)}

${RULES(profile, lead.firstName)}

You may use WebSearch or WebFetch only if the comment asks for something you'd need to look up.
Reply with ONLY the full updated JSON in exactly the same shape, no prose:
${SHAPE}`;

  const out = tidy(await askClaudeJson(prompt, { tools: WEB_TOOLS, timeoutMs: 5 * 60 * 1000 }));
  const deckPages = syncPageCount(out);
  const deckPath = await renderDeck({ lead, profile, content: out, brand: g.brand || {} });
  return {
    deckPages,
    research: out.research || g.research,
    hookSource: out.hook_source || g.hookSource,
    hook: hookQuality(out, g.hook),
    problem: out.problem || g.problem,
    subject: out.subject,
    email1: out.email1,
    followup1: out.followup1,
    followup2: out.followup2,
    deck: out.deck,
    deckPath,
    generatedAt: Date.now(),
  };
}

// Reads the firm's portfolio links first, then asks Claude to build the profile only from what was read.
export async function autoReadPortfolio(profile) {
  const sources = await collectPortfolio(profile.portfolioLinks, profile.website);
  const notTest = (v) => (v && !/\bTEST\b/.test(v) ? v : '');
  const prompt = `You're building the firm profile that every cold email and pitch deck for this firm will be written from. Accuracy matters more than polish: a wrong claim here ends up in front of real prospects.

## The firm
Name: ${profile.companyName || '(not given)'}
Founder or sender: ${profile.senderName || '(not given)'}${profile.senderTitle ? `, ${profile.senderTitle}` : ''}
Clients they listed themselves: ${notTest(profile.notableClients) || '(none)'}
Their own description of their work: ${notTest(profile.brandWork) || '(nothing)'}
About the company: ${notTest(profile.about) || '(nothing)'}

## Evidence the app read from their portfolio links
${formatSources(sources)}

## Your job
1. Work out what the firm does, for whom, and what makes it different, using only the evidence above and their own words. You may use WebFetch to open a public page named in the evidence if a detail is unclear. Skip anything that needs a sign-in.
2. List every piece of real work you can tie to a named client or project. File and folder names count as evidence: "Home Centre Diwali.mp4" means they made a Diwali video for Home Centre. Don't guess formats, results or dates you can't see. When a deck or page states outcomes for a piece of work (reach, views, engagement, retention), copy those numbers exactly into that item's result, and nowhere else.
3. Write "what you solve" as 3 to 5 lines in the firm's own voice, starting with "We". Each line: a buyer problem, how the firm solves it, and one or two named clients as proof. Full sentences, no fragments, under 35 words per line.
4. Note what's missing that would make their outreach stronger.

## Rules
- Never invent clients, numbers, results, awards, team size or years. If the evidence doesn't show it, leave it out. Any number in "what you solve" must match a result you recorded, with its client named.
- Ignore anything marked TEST or clearly placeholder.
- Spell client names the way the evidence does, for example "Dunkin'".
- Plain, confident words and contractions. No em dashes or en dashes. No hype words like leverage, synergy, cutting-edge, elevate.

Reply with ONLY this JSON:
{
  "firmSummary": "one or two sentences, starting with We",
  "services": ["short noun phrases, e.g. brand films, short-form reels"],
  "industries": ["short noun phrases, e.g. QSR and food, beauty"],
  "proof": [{ "client": "name", "work": "what they made, max 14 words", "result": "outcomes or numbers the evidence states for this work, copied exactly, or empty string", "evidence": "where it was seen, e.g. Drive: Home Centre Diwali.mp4" }],
  "whatYouSolve": ["We ...", "We ...", "We ..."],
  "notableClients": ["names, best known first"],
  "gaps": ["max 4 short items, e.g. no results or numbers shown for any project"]
}`;

  const out = await askClaudeJson(prompt, { tools: ['WebFetch'], timeoutMs: 6 * 60 * 1000 });
  return {
    firmSummary: clean(out.firmSummary),
    services: names(out.services),
    industries: names(out.industries),
    proof: (Array.isArray(out.proof) ? out.proof : [])
      .map((x) => ({ client: clean(x?.client), work: clean(x?.work), result: labelledResult(x?.result), evidence: clean(x?.evidence) }))
      .filter((x) => x.client && x.work)
      .slice(0, 30),
    whatYouSolve: lines(out.whatYouSolve).slice(0, 5),
    notableClients: names(out.notableClients),
    gaps: lines(out.gaps).slice(0, 4),
    sources: sources.map(({ url, kind, ok, error, items, title }) => ({ url, kind, ok, error, title, count: items?.length })),
  };
}

export async function classifyReply(lead, replyText, profile) {
  const prompt = `${profile.senderName || 'A sender'} at ${profile.companyName || 'a services company'} sent a cold email to ${lead.fullName} (${lead.title}) at ${lead.company}. This is the reply:

"""
${replyText}
"""

Classify it. Reply with ONLY this JSON:
{
  "temperature": "hot or cold. hot = interested, asks a question, wants a call, asks for pricing or info, or points to the right person. cold = not interested, unsubscribe, wrong person with no referral.",
  "isAutoReply": true or false (out-of-office or automated),
  "summary": "what they said, max 15 words",
  "nextSteps": "the single best next step for the sender, max 20 words"
}
No em dashes.`;
  const out = await askClaudeJson(prompt, { timeoutMs: 2 * 60 * 1000 });
  return {
    temperature: out.temperature === 'hot' ? 'hot' : 'cold',
    isAutoReply: !!out.isAutoReply,
    summary: clean(out.summary),
    nextSteps: clean(out.nextSteps),
  };
}
