// Lead sources for v0: Prospeo API, Hunter API, and CSV upload (Apollo export or any CSV).

// Prospeo only accepts these exact department / seniority values.
const DEPT_PROSPEO = {
  Marketing: 'Marketing',
  Sales: 'Sales',
  'Human Resources': 'Human Resources',
  'Engineering & Technical': 'Engineering & Technical',
  'Information Technology': 'Information Technology',
  Product: 'Product',
  Finance: 'Finance',
  Operations: 'Operations',
  Legal: 'Legal',
};
const DEPT_HUNTER = {
  Marketing: 'marketing',
  Sales: 'sales',
  'Human Resources': 'hr',
  'Engineering & Technical': 'it',
  'Information Technology': 'it',
  Product: 'product',
  Finance: 'finance',
  Operations: 'operations',
  Legal: 'legal',
};
export const DEPARTMENTS = Object.keys(DEPT_PROSPEO);
export const SENIORITY = ['Founder/Owner', 'C-Suite', 'Partner', 'Vice President', 'Head', 'Director', 'Manager', 'Senior', 'Entry', 'Intern'];

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
// Lists pasted from docs carry invisible characters (word joiners, zero-width spaces) and "1." or bullet
// markers; Prospeo rejects a name with any of them, so each line is reduced to the plain name.
const cleanLine = (s) => String(s).replace(/\p{Cf}/gu, '').replace(/\s+/g, ' ').trim()
  .replace(/^(\d{1,3}[.)]|[-*•·●▪◦])\s*/u, '').trim();
const lines = (v) => String(v || '').split(/\r?\n/).map(cleanLine).filter(Boolean);
export const cleanDomain = (s) => String(s || '').trim().replace(/^https?:\/\//i, '').replace(/^www\./i, '').split(/[/?#]/)[0].toLowerCase();
const looksLikeDomain = (s) => /^[a-z0-9-]+(\.[a-z0-9-]+)*\.[a-z]{2,}$/i.test(cleanDomain(s));

// ---------- Prospeo ----------

async function prospeo(pathname, body, key, retry = true) {
  const res = await fetch(`https://api.prospeo.io${pathname}`, {
    method: 'POST',
    headers: { 'X-KEY': key, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (res.status === 429 && retry) {
    await sleep(2500);
    return prospeo(pathname, body, key, false);
  }
  const json = await res.json().catch(() => ({}));
  if (json.error || !res.ok) {
    const code = json.error_code || json.code || `HTTP_${res.status}`;
    const err = new Error(`Prospeo ${code}${json.filter_error ? `: ${json.filter_error}` : json.message ? `: ${json.message}` : ''}`);
    err.code = code;
    throw err;
  }
  return json;
}

export async function prospeoFind({ companies, departments = [], seniority = [], perCompany = 4, max = 25 }, key) {
  if (!key) throw new Error('Connect Prospeo in Settings first');
  const targets = lines(companies);
  if (!targets.length) throw new Error('Add at least one target company (name or website), one per line');
  const limit = Math.min(Math.max(Number(max) || 25, 1), 200);

  const baseFilters = {};
  const depts = departments.map((d) => DEPT_PROSPEO[d]).filter(Boolean);
  if (depts.length) baseFilters.person_department = { include: depts };
  const sen = seniority.filter((s) => SENIORITY.includes(s));
  if (sen.length) baseFilters.person_seniority = { include: sen };
  // Search results stop at this many people per company, so credits aren't spent on the ninth person at one brand.
  baseFilters.max_person_per_company = Math.min(Math.max(Math.round(Number(perCompany)) || 4, 1), 100);

  // Prospeo takes a company list as filters.company.{websites,names} (up to 500), both in one search.
  const websites = targets.filter(looksLikeDomain).map(cleanDomain);
  const names = targets.filter((t) => !looksLikeDomain(t));
  const company = {};
  if (websites.length) company.websites = { include: websites.slice(0, 500) };
  if (names.length) company.names = { include: names.slice(0, 500) };
  const groups = [{ ...baseFilters, company }];

  // Many people have no verified email, so gather up to twice as many candidates as leads wanted.
  // A person without a verified email answers NO_MATCH and is not charged.
  const candidates = Math.min(limit * 2, 400);
  const stats = { searchCredits: 0, found: 0, withEmail: 0, noEmail: 0, emailCredits: 0 };
  const people = [];
  for (const filters of groups) {
    for (let page = 1; people.length < candidates; page++) {
      let res;
      try {
        res = await prospeo('/search-person', { page, filters }, key);
      } catch (e) {
        if (e.code === 'NO_RESULTS') break;
        throw e;
      }
      if (!res.free) stats.searchCredits++;
      for (const r of res.results || []) {
        if (people.length >= candidates) break;
        people.push(r);
      }
      if (page >= (res.pagination?.total_page || 1)) break;
    }
  }
  stats.found = people.length;

  const leads = [];
  for (const { person, company } of people) {
    if (leads.length >= limit) break;
    try {
      const res = await prospeo('/enrich-person', {
        only_verified_email: true,
        enrich_mobile: false,
        data: { person_id: person.person_id },
      }, key);
      const email = res.person?.email?.email;
      if (!email) { stats.noEmail++; continue; }
      if (!res.free_enrichment) stats.emailCredits++;
      stats.withEmail++;
      const c = res.company || company || {};
      const p = res.person || person;
      const job = (p.job_history || []).find((j) => j.current) || {};
      const loc = p.location;
      leads.push({
        firstName: p.first_name,
        lastName: p.last_name,
        fullName: p.full_name,
        title: p.current_job_title || job.title,
        department: (job.departments || [])[0],
        company: c.name || job.company_name,
        domain: c.domain,
        website: c.website,
        logo: c.logo_url,
        linkedin: p.linkedin_url,
        location: loc && typeof loc === 'object' ? [loc.city, loc.state, loc.country].filter(Boolean).join(', ') : loc,
        email,
        emailStatus: res.person.email.status || 'VERIFIED',
      });
    } catch (e) {
      if (e.code === 'INSUFFICIENT_CREDITS' || e.code === 'INVALID_API_KEY') {
        stats.stopped = e.message;
        break;
      }
      stats.noEmail++;
      if (e.code !== 'NO_MATCH' && !stats.emailError) stats.emailError = e.message;
    }
  }
  return { leads, stats };
}

// ---------- Apollo (the customer's own Apollo key) ----------
// People search costs no Apollo credits; each verified email revealed through enrichment costs 1.

const APOLLO_SENIORITY = {
  'Founder/Owner': ['founder', 'owner'], 'C-Suite': ['c_suite'], Partner: ['partner'], 'Vice President': ['vp'],
  Head: ['head'], Director: ['director'], Manager: ['manager'], Senior: ['senior'], Entry: ['entry'], Intern: ['intern'],
};
// Apollo's search has no team filter, so each team becomes the job-title words it goes by.
const APOLLO_TITLES = {
  Marketing: ['marketing', 'brand', 'content', 'social media', 'growth', 'communications'],
  Sales: ['sales', 'business development', 'partnerships'],
  'Human Resources': ['human resources', 'people', 'talent'],
  'Engineering & Technical': ['engineering', 'technology'],
  'Information Technology': ['information technology'],
  Product: ['product'],
  Finance: ['finance', 'accounts'],
  Operations: ['operations'],
  Legal: ['legal'],
};
const letters = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]/g, '');

async function apollo(pathname, { query = {}, body = {} }, key) {
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(query)) {
    if (Array.isArray(v)) v.forEach((x) => qs.append(`${k}[]`, x));
    else if (v !== undefined) qs.set(k, String(v));
  }
  const res = await fetch(`https://api.apollo.io/api/v1${pathname}${qs.size ? `?${qs}` : ''}`, {
    method: 'POST',
    headers: { 'x-api-key': key, 'Content-Type': 'application/json', 'Cache-Control': 'no-cache' },
    body: JSON.stringify(body),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok || json.error) {
    let message = `Apollo: ${json.error || json.error_message || json.message || `HTTP ${res.status}`}`;
    if (res.status === 401) message = 'Apollo rejected that API key. Copy it again from Apollo: settings, API keys.';
    else if (res.status === 403 || json.error_code === 'API_INACCESSIBLE') message = "This Apollo key can't search people. In Apollo, make it a master key, or give it the people search and people enrichment endpoints.";
    else if (res.status === 429) message = "Apollo's hourly limit is used up. Try again in an hour.";
    throw Object.assign(new Error(message), { status: res.status, code: json.error_code });
  }
  return json;
}

export async function apolloFind({ companies, departments = [], seniority = [], perCompany = 4, max = 20 }, key) {
  if (!key) throw new Error('Connect Apollo in Settings first');
  const targets = lines(companies);
  if (!targets.length) throw new Error('Add at least one company (name or website), one per line');
  const limit = Math.min(Math.max(Number(max) || 20, 1), 100);
  const cap = Math.min(Math.max(Math.round(Number(perCompany)) || 4, 1), 25);
  const filters = { contact_email_status: ['verified'] };
  const seniorities = [...new Set(seniority.flatMap((s) => APOLLO_SENIORITY[s] || []))];
  const titles = [...new Set(departments.flatMap((d) => APOLLO_TITLES[d] || []))];
  if (seniorities.length) filters.person_seniorities = seniorities;
  if (titles.length) Object.assign(filters, { person_titles: titles, include_similar_titles: true });

  const stats = { found: 0, withEmail: 0, noEmail: 0, emailCredits: 0, unmatched: [] };
  const candidates = [];
  const atCompany = new Map();
  const take = (people, accept = () => true) => {
    let taken = 0;
    for (const p of people || []) {
      if (candidates.length >= limit * 2) break;
      if (!p?.id || p.has_email === false || !accept(p)) continue;
      const company = letters(p.organization?.name);
      if (company && (atCompany.get(company) || 0) >= cap) continue;
      atCompany.set(company, (atCompany.get(company) || 0) + 1);
      candidates.push(p);
      taken++;
    }
    return taken;
  };

  // Websites go in one search (Apollo takes up to 1,000 domains at once).
  const websites = targets.filter(looksLikeDomain).map(cleanDomain);
  for (let page = 1; websites.length && page <= 3 && candidates.length < limit * 2; page++) {
    const res = await apollo('/mixed_people/api_search', { query: { ...filters, q_organization_domains_list: websites, per_page: 100, page } }, key);
    take(res.people);
    if ((res.people || []).length < 100) break;
  }
  // Apollo can't filter by company name, so each name runs as a keyword search and only matching companies are kept.
  for (const name of targets.filter((t) => !looksLikeDomain(t))) {
    if (candidates.length >= limit * 2) break;
    const want = letters(name);
    const res = await apollo('/mixed_people/api_search', { query: { ...filters, q_keywords: name, per_page: 50, page: 1 } }, key);
    const taken = take(res.people, (p) => {
      const org = letters(p.organization?.name);
      return !!org && (org === want || ((org.startsWith(want) || want.startsWith(org)) && Math.abs(org.length - want.length) <= 10));
    });
    if (!taken) stats.unmatched.push(name);
  }
  stats.found = candidates.length;

  // Emails are revealed 10 at a time, and only as many as are still needed, so no credit is spent past the limit.
  const leads = [];
  for (let i = 0; i < candidates.length && leads.length < limit;) {
    const batch = candidates.slice(i, i + Math.min(10, limit - leads.length));
    i += batch.length;
    const res = await apollo('/people/bulk_match', { body: { details: batch.map((p) => ({ id: p.id })) } }, key);
    stats.emailCredits += Number(res.credits_consumed) || 0;
    for (const m of res.matches || []) {
      if (!m?.email || m.email_status !== 'verified') { stats.noEmail++; continue; }
      const org = m.organization || {};
      const domain = org.primary_domain || (org.website_url ? cleanDomain(org.website_url) : '');
      stats.withEmail++;
      leads.push({
        firstName: m.first_name || '',
        lastName: m.last_name || '',
        fullName: m.name || '',
        title: m.title || '',
        department: String((m.subdepartments || m.departments || [])[0] || '').replace(/^master_/, '').replace(/_/g, ' '),
        company: org.name || '',
        domain,
        website: org.website_url || (domain ? `https://${domain}` : ''),
        logo: org.logo_url || '',
        linkedin: m.linkedin_url || '',
        location: [m.city, m.state, m.country].filter(Boolean).join(', '),
        email: m.email,
        emailStatus: 'VERIFIED',
      });
    }
  }
  return { leads, stats };
}

// ---------- Hunter ----------

export async function hunterFind({ companies, departments = [], perCompany = 10 }, key) {
  if (!key) throw new Error('Connect Hunter in Settings first');
  const targets = lines(companies);
  if (!targets.length) throw new Error('Add at least one company website, one per line');
  const wanted = [...new Set(departments.map((d) => DEPT_HUNTER[d]).filter(Boolean))];
  const stats = { searched: 0, withEmail: 0, failed: [] };
  const leads = [];

  for (const target of targets) {
    const params = new URLSearchParams({
      api_key: key,
      type: 'personal',
      limit: String(Math.min(Math.max(Number(perCompany) || 10, 1), 100)),
    });
    if (looksLikeDomain(target)) params.set('domain', cleanDomain(target));
    else params.set('company', target);
    // One department goes to the API; several are filtered locally so it stays one credit per company.
    if (wanted.length === 1) params.set('department', wanted[0]);

    const res = await fetch(`https://api.hunter.io/v2/domain-search?${params}`);
    const json = await res.json().catch(() => ({}));
    if (!res.ok) {
      const msg = json.errors?.[0]?.details || `HTTP ${res.status}`;
      if (res.status === 401 || res.status === 403) throw new Error(`Hunter: ${msg}`);
      stats.failed.push(`${target}: ${msg}`);
      continue;
    }
    stats.searched++;
    const data = json.data || {};
    let emails = data.emails || [];
    if (wanted.length > 1) emails = emails.filter((e) => wanted.includes(e.department));
    for (const e of emails) {
      if (!e.value) continue;
      stats.withEmail++;
      leads.push({
        firstName: e.first_name || '',
        lastName: e.last_name || '',
        title: e.position || '',
        department: e.department || '',
        company: data.organization || data.domain,
        domain: data.domain,
        website: data.domain ? `https://${data.domain}` : '',
        linkedin: e.linkedin || '',
        email: e.value,
        emailStatus: e.verification?.status || (e.confidence ? `${e.confidence}% confidence` : ''),
      });
    }
  }
  return { leads, stats };
}

// ---------- CSV (Apollo export or any sheet with an Email column) ----------

export function parseCsv(text) {
  const rows = [];
  let row = [];
  let cell = '';
  let quoted = false;
  const src = String(text || '').replace(/^﻿/, '');
  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (quoted) {
      if (ch === '"' && src[i + 1] === '"') { cell += '"'; i++; }
      else if (ch === '"') quoted = false;
      else cell += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ',') { row.push(cell); cell = ''; }
    else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && src[i + 1] === '\n') i++;
      row.push(cell); cell = '';
      if (row.some((c) => c.trim())) rows.push(row);
      row = [];
    } else cell += ch;
  }
  row.push(cell);
  if (row.some((c) => c.trim())) rows.push(row);
  return rows;
}

const COLUMNS = {
  firstName: ['first name', 'first_name', 'firstname'],
  lastName: ['last name', 'last_name', 'lastname'],
  fullName: ['name', 'full name', 'full_name'],
  title: ['title', 'job title', 'position', 'designation'],
  company: ['company name for emails', 'company', 'company name', 'organization', 'account name'],
  email: ['email', 'email address', 'work email', 'e-mail'],
  emailStatus: ['email status'],
  website: ['website', 'company website', 'domain', 'company domain'],
  linkedin: ['person linkedin url', 'linkedin url', 'linkedin'],
  department: ['departments', 'department'],
  location: ['city', 'location', 'country'],
};

export function parseLeadsCsv(text) {
  const [header, ...rows] = parseCsv(text);
  if (!header) throw new Error('The CSV is empty');
  const names = header.map((h) => h.trim().toLowerCase());
  const index = {};
  for (const [field, aliases] of Object.entries(COLUMNS)) {
    const i = aliases.map((a) => names.indexOf(a)).find((n) => n >= 0);
    if (i !== undefined) index[field] = i;
  }
  if (index.email === undefined) throw new Error('No Email column found. Apollo exports have one called "Email".');
  return rows.map((r) => {
    const lead = {};
    for (const [field, i] of Object.entries(index)) lead[field] = (r[i] || '').trim();
    if (lead.website && !/^https?:/i.test(lead.website)) lead.website = `https://${cleanDomain(lead.website)}`;
    return lead;
  });
}
