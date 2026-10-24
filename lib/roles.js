// Role angles: what to lead with, and what to leave out, for the person being written to.
// Matched on job title first, then on the team a lead source reports (like Prospeo's "Brand Management").
// Order matters: leaders are checked before hands-on roles in the same area.
const ANGLES = [
  {
    key: 'founder', label: 'founder or CEO',
    match: /\b(founder|co-?founder|ceo|chief executive|managing director|owner|president)\b/i,
    lead: 'growth, how their brand stands apart, and the outcome a similar company got',
    avoid: 'execution detail, tools and process',
  },
  {
    key: 'marketing-lead', label: 'marketing leader',
    match: /\b(cmo|chief (marketing|brand|growth)|marketing director|(vp|vice president|head|director)\b.{0,20}\b(marketing|brand|communications))\b/i,
    lead: 'brand and campaign results, with named clients as proof',
    avoid: 'vague promises like "more leads" or "go viral"',
  },
  {
    key: 'growth', label: 'growth or performance',
    match: /\b(growth|performance|acquisition|e-?commerce|d2c|demand gen\w*|crm|retention|conversion)\b/i,
    lead: 'measurable results: conversion, cost per result, how fast they can test',
    avoid: 'soft brand language with no number behind it',
  },
  {
    key: 'brand-content', label: 'brand, content or social',
    match: /\b(brand|content|social|creative|community|influencer|communications|pr|copy\w*)\b/i,
    lead: 'taking work off their plate, and ideas or formats they could ship this month',
    avoid: 'boardroom strategy and budget talk',
  },
  {
    key: 'sales', label: 'sales or partnerships',
    match: /\b(sales|business development|partnerships?|revenue|account executive|alliances)\b/i,
    lead: 'pipeline, meetings and faster deals',
    avoid: 'brand theory',
  },
  {
    key: 'product-tech', label: 'product or technology',
    match: /\b(cto|product|engineer\w*|technology|developer|information technology|data)\b/i,
    lead: 'speed, fewer handoffs and less rework',
    avoid: 'marketing fluff',
  },
  {
    key: 'people', label: 'people and hiring',
    match: /\b(hr|human resources|people|talent|recruit\w*|culture)\b/i,
    lead: 'employer brand, hiring and keeping good people',
    avoid: 'sales numbers',
  },
  {
    key: 'finance', label: 'finance or procurement',
    match: /\b(cfo|finance|financial|accounts|procurement|purchas\w*|controller)\b/i,
    lead: 'cost, predictability and return on spend',
    avoid: 'creative jargon',
  },
  {
    key: 'operations', label: 'operations',
    match: /\b(coo|operations|ops|supply chain|logistics)\b/i,
    lead: 'reliability, less coordination and time saved',
    avoid: 'hype',
  },
];
const GENERAL = { key: 'general', label: 'general', lead: 'the problem closest to their company and the most relevant proof', avoid: 'claims that could fit any company' };
const SENIOR = /\b(founder|owner|chief|c[a-z]o|vp|vice president|head|director|partner|president|general manager|gm)\b/i;

export function roleAngle(title = '', department = '') {
  const angle = ANGLES.find((a) => a.match.test(title)) || ANGLES.find((a) => a.match.test(department)) || GENERAL;
  return { key: angle.key, label: angle.label, level: SENIOR.test(title) ? 'decision maker' : 'hands-on', lead: angle.lead, avoid: angle.avoid };
}

export function roleBlock(r) {
  return `## How to pitch this person
Role: ${r.label}, ${r.level}
Lead with: ${r.lead}
Leave out: ${r.avoid}
${r.level === 'decision maker'
    ? 'They decide, so keep it short and about one clear outcome.'
    : "They do the work, so be practical: say what you'd make for them or take off their plate."}
Apply this to the subject, all three emails and the deck.`;
}
