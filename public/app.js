const view = document.getElementById('view');
const tallyEl = document.getElementById('tally');
const TABS = ['you', 'leads', 'review', 'send', 'settings', 'team'];
const TITLES = { you: 'Your firm', leads: 'Leads', review: 'Review', send: 'Outreach', settings: 'Settings', team: 'Team' };

const stored = (() => { try { return localStorage.getItem('tab'); } catch { return null; } })();
let tab = [location.hash.slice(1), stored].find((t) => TABS.includes(t)) || 'leads';
let state = null;
let ids = new Map();
let renderPending = false;
let pointerDown = false;
let leadView = 'all';
let leadQuery = '';
let leadCompany = '';
let leadSort = 'default';
let contactTrigger = null;
let reviewId = null;
let finderMode = 'companies';
// Team screen: the invite code we just asked for, whether the name is being edited, and whether a sync is running.
let inviteCode = null;
let teamRenaming = false;
let teamSyncing = false;

// Unsaved form input survives background refreshes, so a poll never wipes what you typed.
const drafts = new Map();
// Actions still in flight keep their "working" label across refreshes.
const busy = new Set();
// Open/closed state of collapsible sections, also kept across refreshes.
const openDetails = new Set();

// ---------- utils ----------
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;
const cap = (s) => String(s).replace(/^[a-z]/, (c) => c.toUpperCase());
const when = (ms) => {
  if (!ms) return '';
  const d = new Date(ms);
  const today = new Date().toDateString() === d.toDateString();
  return today ? d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' }) : d.toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
};
const countdown = (ms) => {
  const diff = ms - Date.now();
  if (diff <= 0) return 'due now';
  const d = Math.floor(diff / 864e5);
  const h = Math.floor((diff % 864e5) / 36e5);
  const m = Math.floor((diff % 36e5) / 6e4);
  return d ? `${d}d ${h}h` : h ? `${h}h ${m}m` : `${m}m`;
};

async function api(url, body) {
  const res = await fetch(url, body === undefined ? {} : { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const json = await res.json().catch(() => ({ error: `Something went wrong (${res.status})` }));
  // No active license: show the key screen, but never redraw it under someone typing their key.
  if (res.status === 402 && json.license && document.getElementById('license-gate').hidden) showLicenseGate(json.license);
  if (!res.ok) throw new Error(json.error || res.statusText);
  if (json.leads) state = json;
  return json;
}

function toast(msg, kind = 'ok') {
  const el = document.getElementById('toast');
  el.textContent = msg;
  el.className = kind;
  el.hidden = false;
  clearTimeout(toast.t);
  toast.t = setTimeout(() => { el.hidden = true; }, kind === 'error' ? 8000 : 4000);
}

function setTab(next) {
  if (!TABS.includes(next)) return;
  tab = next;
  try { localStorage.setItem('tab', tab); } catch { /* storage blocked */ }
  history.replaceState(null, '', `#${tab}`);
  renderPending = false;
  render();
  window.scrollTo(0, 0);
}

function draftKey(el) {
  const d = el.dataset;
  if (d.key) return `profile:${d.key}`;
  if (d.secret) return `secret:${d.secret}`;
  if (d.setting) return `setting:${d.setting}`;
  if (d.edit) return `edit:${d.id}:${d.edit}`;
  if (el.type === 'checkbox') return el.name ? `check:${el.name}:${el.value}` : null;
  if (el.id && el.type !== 'file') return `id:${el.id}`;
  return null;
}

const clearDrafts = (...prefixes) => {
  for (const k of [...drafts.keys()]) if (prefixes.some((p) => k.startsWith(p))) drafts.delete(k);
};
const busyKey = (b) => `${b.dataset.act}:${b.dataset.id || ''}`;

// Every text area grows to its text, so nothing is ever cut mid-line or scrolls inside itself.
function fitAreas(root = view) {
  root.querySelectorAll('textarea').forEach((t) => {
    if (!t.offsetParent) return;
    t.style.height = 'auto';
    t.style.height = `${t.scrollHeight + 2}px`;
  });
}

function restoreForm() {
  view.querySelectorAll('input, textarea, select').forEach((el) => {
    const k = draftKey(el);
    if (!k || !drafts.has(k)) return;
    if (el.type === 'checkbox') el.checked = drafts.get(k);
    else el.value = drafts.get(k);
  });
  view.querySelectorAll('details[data-detail]').forEach((el) => { el.open = openDetails.has(el.dataset.detail); });
  view.querySelectorAll('button[data-act]').forEach((b) => {
    if (busy.has(busyKey(b))) { b.disabled = true; b.textContent = 'Working'; }
  });
  fitAreas();
}

async function run(button, fn) {
  const key = button ? busyKey(button) : null;
  if (key && busy.has(key)) return;
  if (key) busy.add(key);
  if (button) { button.disabled = true; button.textContent = 'Working'; }
  try {
    await fn();
  } catch (e) {
    toast(e.message, 'error');
  } finally {
    if (key) busy.delete(key);
    render();
  }
}

const editing = () => {
  const a = document.activeElement;
  return a && view.contains(a) && ['TEXTAREA', 'INPUT', 'SELECT'].includes(a.tagName) && a.type !== 'checkbox';
};

function stage(l) {
  const g = l.gen || {};
  if (l.outreach?.email1) return { key: 'sent', label: 'sent' };
  if (l.outreach?.queued) return { key: 'queued', label: 'queued to send' };
  if (l.approved) return { key: 'approved', label: 'approved' };
  if (['queued', 'running'].includes(g.status)) return { key: 'writing', label: 'writing' };
  if (g.status === 'done') return { key: 'ready', label: 'to review' };
  if (g.status === 'error') return { key: 'error', label: 'needs a retry' };
  return { key: 'new', label: 'new' };
}

// ---------- building blocks ----------
const ICONS = {
  search: '<circle cx="11" cy="11" r="6.5"/><path d="m16 16 4 4"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  upload: '<path d="M12 15V4m-4 4 4-4 4 4M5 15v4a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-4"/>',
  arrow: '<path d="M5 12h14m-5-5 5 5-5 5"/>',
  close: '<path d="m6 6 12 12M6 18 18 6"/>',
  key: '<circle cx="8" cy="15" r="4"/><path d="m10.8 12.2 9.2-9.2M17 6l3 3M14.5 8.5l2 2"/>',
  mail: '<rect x="3" y="5" width="18" height="14" rx="2.5"/><path d="m3.5 7 8.5 6 8.5-6"/>',
  sparkle: '<path d="M12 3.5 13.8 9l5.7 1.8-5.7 1.8L12 18.5l-1.8-5.9-5.7-1.8L10.2 9Z"/>',
  person: '<circle cx="12" cy="8" r="3.5"/><path d="M5 20a7 7 0 0 1 14 0"/>',
  building: '<rect x="5" y="3" width="14" height="18" rx="1.5"/><path d="M9 7h1.5M13.5 7H15M9 11h1.5M13.5 11H15M10 21v-4h4v4"/>',
  status: '<circle cx="12" cy="12" r="8"/><path d="m8.5 12 2.5 2.5 4.5-5"/>',
  clock: '<circle cx="12" cy="12" r="8"/><path d="M12 8v4l2.5 2"/>',
  shield: '<path d="M12 3 5 6v5c0 4.5 3 8 7 10 4-2 7-5.5 7-10V6Z"/>',
  sliders: '<path d="M4 7h10M18 7h2M4 17h2M10 17h10"/><circle cx="16" cy="7" r="2"/><circle cx="8" cy="17" r="2"/>',
  steps: '<circle cx="5" cy="12" r="2"/><circle cx="12" cy="12" r="2"/><circle cx="19" cy="12" r="2"/><path d="M7 12h3M14 12h3"/>',
  team: '<rect x="9" y="3" width="6" height="5" rx="1.5"/><rect x="3" y="16" width="6" height="5" rx="1.5"/><rect x="15" y="16" width="6" height="5" rx="1.5"/><path d="M12 8v4M6 16v-2h12v2"/>',
};
const icon = (name) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONS[name] || ICONS.arrow}</svg>`;
const th = (ic, label) => `<span class="th">${icon(ic)}${label}</span>`;

const chip = (key, label) => `<span class="chip chip-${key}">${esc(cap(label))}</span>`;
const cmd = (label, attrs = '', cls = '') => `<button class="btn ${cls}" ${attrs}>${cap(label)}</button>`;
const heading = (text, lede = '', { count, actions = '' } = {}) => `
  <div class="page-heading">
    <div><h1>${text}${count !== undefined ? ` <span class="heading-count">${count}</span>` : ''}</h1>${lede ? `<p class="lede">${lede}</p>` : ''}</div>
    ${actions ? `<div class="heading-actions">${actions}</div>` : ''}
  </div>`;
const emptyState = (title, text, action = '') => `<div class="empty-state"><h2>${title}</h2><p class="note">${text}</p>${action}</div>`;
const card = (title, desc, body, action = '') => `
  <section class="panel form-card">
    <div class="card-head"><div><h2>${title}</h2>${desc ? `<p>${desc}</p>` : ''}</div>${action}</div>
    ${body}
  </section>`;

const initials = (name) => String(name || '?').split(/\s+/).filter(Boolean).slice(0, 2).map((x) => x[0]).join('').toUpperCase();
const avClass = (name) => `av-${[...String(name || '')].reduce((a, c) => a + c.charCodeAt(0), 0) % 6}`;
const avatar = (l, extra = '') => `<span class="avatar ${avClass(l.fullName)} ${extra}" aria-hidden="true">${esc(initials(l.fullName))}</span>`;
const personButton = (l, sub) => `<button class="person" data-act="open-contact" data-id="${esc(l.id)}">${avatar(l)}<span class="person-text"><strong>${esc(l.fullName)}</strong><span>${esc(sub)}</span></span></button>`;

// A moment in the sender's time zone, like "Mon 09:00".
const sendTime = (ms) => {
  if (!ms || ms - Date.now() < 60 * 1000) return 'now';
  const opts = { weekday: 'short', hour: '2-digit', minute: '2-digit' };
  try { return new Date(ms).toLocaleString(undefined, { ...opts, timeZone: state.settings.timezone }); } catch { return new Date(ms).toLocaleString(undefined, opts); }
};

// Where the opening line came from and who the email was pitched to, so weak drafts stand out.
const HOOK_LABEL = { person: 'their own words', company: 'company news', website: 'website only' };
const hookChip = (g) => {
  if (g?.hook) return `<span class="chip chip-plain tier-${esc(g.hook.tier)}"><b>${g.hook.score}</b>/10 · ${esc(HOOK_LABEL[g.hook.tier] || g.hook.tier)}</span>`;
  return '<span class="cell-muted">Not scored</span>';
};
function hookLine(g) {
  const parts = [];
  if (g.hook) parts.push(hookChip(g));
  if (g.role) parts.push(`<span class="chip chip-plain">Pitched for ${esc(g.role.label)}, ${esc(g.role.level)}</span>`);
  if (!parts.length) return '';
  const weak = g.hook?.tier === 'website';
  return `<div class="hook-line">${parts.join('')}${weak ? '<p class="hook-warn">Nothing specific found about them. Read the opening before you approve.</p>' : ''}</div>`;
}

function scheduleNote() {
  const { open, next, sentToday, cap: dayCap } = state.sending;
  const count = `${sentToday} of ${dayCap} sent today`;
  const zone = `Times are ${esc(state.settings.timezone)}.`;
  if (sentToday >= dayCap) return `Today's limit is reached (${count}). The rest go out when sending hours next open. ${zone}`;
  if (open) return `Sending hours are open: queued emails go out one a minute. ${count}. ${zone}`;
  return next ? `Outside sending hours. Queued emails go out ${esc(sendTime(next))}. ${count}. ${zone}` : 'Sending hours never open. Check the times above.';
}

const liveSendMessage = (r) => {
  if (r.errors?.length) return `Couldn't send: ${r.errors[0]}`;
  const rest = r.queued - r.sentNow;
  if (r.sentNow && rest <= 0) return 'Sent.';
  if (r.capReached) return `Today's limit is reached. ${plural(rest, 'email waits', 'emails wait')} for the next sending day.`;
  if (r.next) return `${plural(rest, 'email', 'emails')} queued for ${sendTime(r.next)}, then one a minute.`;
  return r.sentNow ? `Sent 1. The other ${rest} go out one a minute.` : `${plural(rest, 'email', 'emails')} queued, going out one a minute.`;
};

// "Who do you want to reach" can hold a list of company names; those belong in the Leads search.
const icpCompanies = (icp) => {
  const rows = String(icp || '').replace(/\p{Cf}/gu, '').split(/\r?\n/)
    .map((l) => l.replace(/^\s*(\d{1,3}[.)]|[-*•·●▪◦])\s*/u, '').trim()).filter(Boolean);
  return rows.length >= 3 && rows.every((l) => l.length <= 40) ? rows : [];
};

// What the portfolio read actually found, so the evidence behind every claim is visible.
function portfolioNote(p) {
  if (!p.portfolioReadAt) return '';
  const read = (p.portfolioSources || []).filter((s) => s.ok).map((s) => (s.count ? `${s.kind} (${s.count} files)` : s.kind)).join(', ');
  const proof = p.proof || [];
  const gaps = (p.portfolioGaps || []).map((g) => g.replace(/\.$/, ''));
  return `
    <p class="note" style="margin-top:8px">Read ${esc(read || 'nothing')} on ${when(p.portfolioReadAt)}. Found ${plural(proof.length, 'piece of work', 'pieces of work')}.${gaps.length ? ` Worth adding: ${esc(gaps.join('; '))}.` : ''}</p>
    ${proof.length ? `<details class="disclosure" data-detail="proof" style="margin-top:8px"><summary>Work we found (${proof.length})</summary><ul class="history">${proof.map((x) => `<li><span>${esc(x.client)}: ${esc(x.work)}</span>${x.result ? `<span class="proof-result">${esc(x.result)}</span>` : ''}</li>`).join('')}</ul></details>` : ''}`;
}

// ---------- render ----------
function render() {
  if (!state) return;
  // Never redraw under the cursor or mid-click; catch up once the user lets go.
  if (editing() || pointerDown || document.getElementById('contact-drawer').open) { renderPending = true; return; }
  renderPending = false;

  ids = new Map([...state.leads].sort((a, b) => a.createdAt - b.createdAt).map((l, i) => [l.id, `#${String(i + 1).padStart(3, '0')}`]));
  const counts = {
    leads: state.leads.length,
    review: state.leads.filter((l) => stage(l).key === 'ready').length,
    send: state.leads.filter((l) => stage(l).key === 'approved').length,
  };
  document.querySelectorAll('#tabs [data-tab]').forEach((b) => {
    const on = b.dataset.tab === tab;
    b.classList.toggle('active', on);
    if (on) b.setAttribute('aria-current', 'page');
    else b.removeAttribute('aria-current');
  });
  document.querySelectorAll('[data-count]').forEach((c) => { c.textContent = counts[c.dataset.count] || ''; });
  // Team only appears once this laptop is on one, but #team still opens either way.
  document.querySelector('#tabs [data-tab="team"]').hidden = !state.team;
  document.title = `${TITLES[tab]} · 4ruple.ai`;
  document.getElementById('route-name').textContent = TITLES[tab];
  document.getElementById('workspace-name').textContent = state.profile.companyName || 'Your workspace';
  document.getElementById('workspace-initial').textContent = (state.profile.companyName || '4').slice(0, 1).toUpperCase();
  // The sending mode is always visible, so nobody sends for real by accident.
  const live = !state.settings.testMode;
  const modeSide = document.getElementById('send-mode');
  const modeTop = document.getElementById('send-mode-top');
  modeSide.classList.toggle('is-live', live);
  modeTop.classList.toggle('is-live', live);
  modeSide.innerHTML = live
    ? '<i></i><span>Live sending<small>Emails go to real people</small></span>'
    : '<i></i><span>Preview mode<small>Emails come to your inbox</small></span>';
  modeTop.textContent = live ? 'Live sending' : 'Preview mode';
  document.getElementById('setup').innerHTML = renderSetup();
  tallyEl.innerHTML = renderTally();

  const y = window.scrollY;
  view.innerHTML = { you: renderYou, leads: renderLeads, review: renderReview, send: renderSend, settings: renderSettings, team: renderTeam }[tab]();
  restoreForm();
  if (tab === 'leads') applyLeadFilters();
  window.scrollTo(0, y);
}

// Only what's non-zero, with the work waiting on the user first.
function renderTally() {
  const leads = state.leads;
  const count = (k) => leads.filter((l) => stage(l).key === k).length;
  const next = leads.map((l) => l.nextDue?.at).filter(Boolean).sort((a, b) => a - b)[0];
  const cells = [
    ['to review', count('ready')],
    ['writing', state.queue.running + state.queue.waiting],
    ['approved', count('approved')],
    ['sent', leads.filter((l) => l.outreach?.email1).length],
    ['replies', leads.filter((l) => l.outreach?.status === 'replied').length],
  ].filter(([, n]) => n > 0);
  if (next) cells.push(['next follow-up', countdown(next)]);
  return cells.map(([label, value]) => `<span>${label}<b>${esc(value)}</b></span>`).join('');
}

// First-run checklist built only from what is actually done.
function renderSetup() {
  const p = state.profile;
  const c = state.connections;
  const leads = state.leads;
  const steps = [
    ['Describe your firm', !!(p.senderName && p.companyName && p.whatYouSolve), 'you'],
    ['Connect lead search', !!(c.apollo || c.prospeo || c.hunter), 'settings'],
    ['Add people', leads.length > 0, 'leads'],
    ['Approve an email', leads.some((l) => l.approved || l.outreach?.email1), 'review'],
    ['Connect Gmail', !!c.inbox, 'settings'],
  ];
  const done = steps.filter((s) => s[1]).length;
  if (done === steps.length) return '';
  const next = steps.find((s) => !s[1]);
  return `<a class="setup" href="#${next[2]}"><span class="setup-top">Getting started<span>${done}/${steps.length}</span></span><span class="setup-bar"><i style="width:${Math.round((done / steps.length) * 100)}%"></i></span><span class="setup-next">Next: ${next[0]}</span></a>`;
}

const field = (key, label, value, type = 'text', placeholder = '') => `
  <label class="field"><span>${label}</span><input data-key="${key}" type="${type}" value="${esc(value)}" placeholder="${esc(placeholder)}"></label>`;
// A one-line field that wraps long values (links, sentences) instead of clipping them.
const line = (key, label, value, placeholder = '') => `
  <label class="field"><span>${label}</span><textarea class="single" data-key="${key}" rows="1" placeholder="${esc(placeholder)}">${esc(value)}</textarea></label>`;
const area = (key, label, value, rows = 3, placeholder = '') => `
  <label class="field"><span>${label}</span><textarea data-key="${key}" rows="${rows}" placeholder="${esc(placeholder)}">${esc(value)}</textarea></label>`;
const chips = (name, options, selected) => `<div class="chips">${options.map((o) => `
  <label class="toggle"><input type="checkbox" name="${name}" value="${esc(o)}" ${selected.includes(o) ? 'checked' : ''}><span>${esc(o)}</span></label>`).join('')}</div>`;

// ---------- your firm ----------
function renderYou() {
  const p = state.profile;
  const o = state.options;
  const save = cmd('Save and find people', 'type="button" data-act="save-profile"', 'primary');
  return `
<div class="narrow">
  ${heading('Your firm', 'Every email and deck is written from this.', { actions: save })}
  <form id="profile-form" class="stack" onsubmit="return false">
    ${card('About you', 'Who the emails come from, and where people book a call.', `
      <div class="grid2">
        ${field('senderName', 'your name', p.senderName)}
        ${field('senderTitle', 'your title', p.senderTitle, 'text', 'Founder')}
        ${field('companyName', 'company', p.companyName)}
        ${line('website', 'website', p.website, 'https://')}
      </div>
      ${line('calendly', 'booking link', p.calendly, 'Calendly or similar')}`)}
    ${card('Your work', 'We read your portfolio for real clients and results, so every claim in an email is true.', `
      ${area('portfolioLinks', 'portfolio links', p.portfolioLinks, 2, 'One link per line')}
      <div class="field">
        <label class="label" for="what-you-solve">What you solve for clients</label>
        <textarea id="what-you-solve" data-key="whatYouSolve" rows="3" placeholder="E.g. We make fresh ad videos every week for brands without an in-house team">${esc(p.whatYouSolve)}</textarea>
        ${portfolioNote(p)}
      </div>
      <details class="disclosure" data-detail="more-profile">
        <summary>More detail</summary>
        ${line('notableClients', 'best-known clients', p.notableClients)}
        ${area('brandWork', 'your work, in your words', p.brandWork, 3, 'Clients, what you did, results')}
        ${area('about', 'about the company', p.about, 2)}
      </details>`, cmd(`${icon('sparkle')}Fill from my portfolio`, 'type="button" data-act="autoread"', 'small'))}
    ${card('Who to reach', 'The companies you want to work with, and which teams inside them to email.', `
      ${line('icp', 'who do you want to reach', p.icp, 'E.g. D2C beauty brands in India, or a list of company names')}
      <div class="field"><span>teams to contact</span>${chips('departments', o.departments, p.departments)}</div>
      <details class="disclosure" data-detail="seniority">
        <summary>Seniority</summary>
        ${chips('seniority', o.seniority, p.seniority)}
      </details>`)}
  </form>
  <div class="form-foot">${save}</div>
</div>`;
}

// ---------- leads ----------
const matchesLeadView = (l, key) => key === 'all' || ({ new: ['new', 'error'], review: ['ready', 'writing'], approved: ['approved'], outreach: ['sent', 'queued'] }[key] || []).includes(stage(l).key);
// The latest thing that happened to a person, in words, with its time when one is recorded.
function activity(l) {
  const o = l.outreach || {};
  const g = l.gen || {};
  if (o.status === 'replied') return ['Replied', o.repliedAt];
  if (o.status === 'bounced') return ['Bounced', o.bouncedAt];
  if (o.followup2) return ['Follow-up 2 sent', o.followup2.sentAt];
  if (o.followup1) return ['Follow-up 1 sent', o.followup1.sentAt];
  if (o.email1) return [o.email1.test ? 'Preview sent' : 'Emailed', o.email1.sentAt];
  if (o.queued) return ['Queued to send', o.queued.at];
  if (['queued', 'running'].includes(g.status)) return ['Writing now', g.startedAt];
  if (l.approved) return l.approvedAt ? ['Approved', l.approvedAt] : ['Draft written', g.generatedAt];
  if (g.subject) return ['Draft written', g.generatedAt];
  if (g.status === 'error') return ['Writing failed', g.startedAt];
  return ['Added', l.createdAt];
}
const activityCell = (l) => {
  const [label, at] = activity(l);
  return `<span class="activity">${label}${at ? ` <span class="mono">${esc(when(at))}</span>` : ''}</span>`;
};

function personLine(l, n, showHook) {
  const s = stage(l);
  return `<tr class="person-row" data-lead="${esc(l.id)}">
    <td class="cell-pick"><input type="checkbox" name="pick" value="${esc(l.id)}" aria-label="Select ${esc(l.fullName)}"></td>
    <td class="cell-num">${n}</td>
    <td class="cell-person">${personButton(l, l.title || 'Role not provided')}</td>
    <td class="cell-company"><span class="company-cell">${l.logo ? `<img class="co-logo" src="${esc(l.logo)}" alt="" loading="lazy" onerror="this.remove()">` : ''}<span><span class="company">${esc(l.company || 'Not provided')}</span>${l.domain ? `<span class="sub">${esc(l.domain)}</span>` : ''}</span></span></td>
    <td class="cell-email">${esc(l.email || 'Not provided')}</td>
    <td class="cell-status"><span class="status-cell">${chip(s.key, s.key === 'approved' ? 'email approved' : s.label)}${withChip(l)}</span></td>
    ${showHook ? `<td class="cell-hook">${hookChip(l.gen)}</td>` : ''}
    <td class="cell-activity">${activityCell(l)}</td>
    <td class="cell-open"><button class="icon-button" data-act="open-contact" data-id="${esc(l.id)}" aria-label="Open ${esc(l.fullName)}">${icon('arrow')}</button></td>
  </tr>`;
}

function renderLeads() {
  const c = state.connections;
  const targets = icpCompanies(state.profile.icp);
  const canSearch = c.apollo || c.prospeo || c.hunter;
  const leads = state.leads;
  const companies = [...new Set(leads.map((l) => l.company).filter(Boolean))].sort();
  const ordered = [...leads].sort((a, b) => (leadSort === 'name' ? a.fullName.localeCompare(b.fullName)
    : leadSort === 'company' ? (a.company || '').localeCompare(b.company || '')
      : (b.createdAt || 0) - (a.createdAt || 0)));
  const views = [['all', 'All people'], ['new', 'New'], ['review', 'To review'], ['approved', 'Approved'], ['outreach', 'In outreach']];
  const showHook = leads.some((l) => l.gen?.hook);
  const finderOpen = openDetails.has('find-panel');
  // Find people floats over the table from the black pill, with a switch between companies and a CSV upload.
  const finder = `
    <div class="finder-anchor">
      <button class="btn primary" data-act="toggle-find" aria-controls="find-panel" aria-expanded="${finderOpen}">${icon('plus')}Find people</button>
      <details class="finder" data-detail="find-panel" id="find-panel"><summary>Find people</summary>
        <div class="finder-head">
          <div class="segmented" role="tablist" aria-label="How to add people">
            <button role="tab" aria-selected="${finderMode === 'companies'}" class="${finderMode === 'companies' ? 'is-on' : ''}" data-act="finder-mode" data-key="companies">${icon('building')}Companies</button>
            <button role="tab" aria-selected="${finderMode === 'csv'}" class="${finderMode === 'csv' ? 'is-on' : ''}" data-act="finder-mode" data-key="csv">${icon('upload')}Upload CSV</button>
          </div>
          <button class="icon-button" data-act="toggle-find" aria-label="Close">${icon('close')}</button>
        </div>
        ${finderMode === 'companies' ? `
        <div class="finder-body">
          <p class="note">Up to ${state.settings.perCompany} people per company, from the teams on your firm profile. Only verified emails are added.</p>
          <label class="field"><span>Company names or websites</span><textarea id="find-companies" rows="4" placeholder="beardo.in&#10;sleepyowl.co"></textarea></label>
          <div class="finder-actions">${targets.length ? `<button class="link" data-act="use-targets">Use ${targets.length} companies from your firm profile</button>` : '<span></span>'}${cmd('Find people', 'data-act="find"', 'primary')}</div>
          ${canSearch ? '' : '<p class="note" style="margin-top:10px">Connect lead search in <a href="#settings">Settings</a> first, or upload a CSV.</p>'}
        </div>` : `
        <div class="finder-body">
          <label class="dropzone">${icon('upload')}<strong>Choose a CSV file</strong><span class="note">Apollo exports work, or any sheet with an Email column.</span><input id="csv-file" type="file" accept=".csv,text/csv"></label>
        </div>`}
      </details>
    </div>`;
  return `
  ${heading('Leads', 'Find your next customer. Make every introduction count.', { count: leads.length, actions: finder })}
  <div class="panel table-panel">
    <nav class="views" aria-label="Lead views">${views.map(([key, label]) => `<button data-act="lead-view" data-key="${key}" class="view-tab${leadView === key ? ' is-active' : ''}" aria-pressed="${leadView === key}">${label}<span>${leads.filter((l) => matchesLeadView(l, key)).length}</span></button>`).join('')}</nav>
    <div class="toolbar" id="lead-toolbar">
      <div class="toolbar-left">
        <label class="search">${icon('search')}<input id="lead-search" type="search" value="${esc(leadQuery)}" placeholder="Search people, companies or emails" aria-label="Search people"></label>
        <select id="lead-company" class="select-chip" aria-label="Filter by company"><option value="">All companies</option>${companies.map((x) => `<option${leadCompany === x ? ' selected' : ''}>${esc(x)}</option>`).join('')}</select>
        <select id="lead-sort" class="select-chip" aria-label="Sort people"><option value="default"${leadSort === 'default' ? ' selected' : ''}>Recently added</option><option value="name"${leadSort === 'name' ? ' selected' : ''}>Name A to Z</option><option value="company"${leadSort === 'company' ? ' selected' : ''}>Company A to Z</option></select>
      </div>
      <div class="toolbar-right"><span class="selection">Tick people to write their emails</span></div>
      <div class="bulk-bar" id="bulk-bar" hidden>
        <span id="selection-count" aria-live="polite"></span>
        <button class="bulk-btn" data-act="generate-selected">${icon('sparkle')}Write emails</button>
        <button class="bulk-clear" data-act="clear-selection">Clear</button>
      </div>
    </div>
    <div class="table-scroll" role="region" aria-label="People table" tabindex="0">
      <table class="table leads-table">
        <caption class="sr-only">People in your workspace</caption>
        <thead><tr>
          <th scope="col" class="cell-pick"><input id="pick-all" type="checkbox" aria-label="Select all visible people"></th>
          <th scope="col" class="cell-num">#</th>
          <th scope="col">${th('person', 'Name')}</th>
          <th scope="col">${th('building', 'Company')}</th>
          <th scope="col">${th('mail', 'Email')}</th>
          <th scope="col">${th('status', 'Status')}</th>
          ${showHook ? `<th scope="col">${th('sparkle', 'Hook')}</th>` : ''}
          <th scope="col">${th('clock', 'Activity')}</th>
          <th scope="col"><span class="sr-only">Open</span></th>
        </tr></thead>
        <tbody>${ordered.map((l, i) => personLine(l, i + 1, showHook)).join('')}</tbody>
      </table>
    </div>
    <div class="table-empty" id="filter-empty" hidden>
      <h2>${leads.length ? 'No people match these filters' : 'Your next conversation starts here'}</h2>
      <p class="note">${leads.length ? 'Try another name, company or view.' : 'Find people at your target companies, or import a CSV to start your list.'}</p>
      ${leads.length ? cmd('Clear filters', 'data-act="clear-filters"') : cmd(`${icon('plus')}Find people`, 'data-act="toggle-find"', 'primary')}
    </div>
    <div class="table-foot"><span id="results-count" aria-live="polite"></span><span>Click a name to see details</span></div>
  </div>`;
}

function updateSelection() {
  const rows = [...view.querySelectorAll('.person-row')];
  const visible = rows.filter((r) => !r.hidden).map((r) => r.querySelector('[name="pick"]'));
  const all = [...view.querySelectorAll('[name="pick"]')];
  const selected = all.filter((el) => el.checked);
  const hiddenCount = selected.filter((el) => el.closest('tr').hidden).length;
  all.forEach((el) => el.closest('tr').classList.toggle('is-selected', el.checked));
  const pickAll = document.getElementById('pick-all');
  if (!pickAll) return;
  const n = visible.filter((el) => el.checked).length;
  pickAll.checked = visible.length > 0 && n === visible.length;
  pickAll.indeterminate = n > 0 && n < visible.length;
  pickAll.disabled = !visible.length;
  // Ticking anyone swaps the filters for a black bulk bar with the one action that applies.
  const selecting = selected.length > 0;
  document.getElementById('lead-toolbar').classList.toggle('is-selecting', selecting);
  const bar = document.getElementById('bulk-bar');
  bar.hidden = !selecting;
  document.getElementById('selection-count').textContent = selecting ? `${selected.length} selected${hiddenCount ? `, ${hiddenCount} outside this view` : ''}` : '';
  const button = bar.querySelector('[data-act="generate-selected"]');
  button.disabled = busy.has('generate-selected:');
  if (!busy.has('generate-selected:')) button.innerHTML = `${icon('sparkle')}Write ${plural(selected.length, 'email', 'emails')}`;
}

function applyLeadFilters() {
  const query = leadQuery.trim().toLocaleLowerCase();
  const lookup = new Map(state.leads.map((l) => [l.id, l]));
  let count = 0;
  view.querySelectorAll('.person-row').forEach((row) => {
    const l = lookup.get(row.dataset.lead);
    row.hidden = !matchesLeadView(l, leadView) || (leadCompany && l.company !== leadCompany) || ![l.fullName, l.company, l.title, l.email].filter(Boolean).join(' ').toLocaleLowerCase().includes(query);
    if (!row.hidden) count++;
  });
  view.querySelectorAll('.view-tab').forEach((button) => {
    button.classList.toggle('is-active', button.dataset.key === leadView);
    button.setAttribute('aria-pressed', String(button.dataset.key === leadView));
  });
  document.getElementById('filter-empty').hidden = count > 0;
  view.querySelector('.table-scroll').hidden = count === 0;
  document.getElementById('results-count').textContent = `Showing ${count} of ${plural(state.leads.length, 'person', 'people')}`;
  updateSelection();
}

function openContact(id) {
  const l = state.leads.find((x) => x.id === id);
  if (!l) return;
  contactTrigger = id;
  const drawer = document.getElementById('contact-drawer');
  const s = stage(l);
  const g = l.gen || {};
  drawer.innerHTML = `
    <div class="drawer-top"><span>Contact details</span><button class="icon-button" data-close aria-label="Close contact details">${icon('close')}</button></div>
    <div class="drawer-body">
      ${avatar(l, 'large')}
      <h2 id="contact-title">${esc(l.fullName)}</h2>
      <p class="contact-role">${esc(l.title || 'Role not provided')}${l.company ? ` at ${esc(l.company)}` : ''}</p>
      <div class="status-cell">${chip(s.key, s.key === 'approved' ? 'email approved' : s.label)}${g.hook ? hookChip(g) : ''}${withChip(l)}</div>
      ${l.teamOwner ? `<p class="note read-only">${esc(teamMate(l.teamOwner))} on your team is already working with ${esc(l.fullName)}, so nothing goes out to them from this laptop.</p>` : ''}
      <dl class="facts">
        <div><dt>Email address</dt><dd class="mono">${esc(l.email || 'Not provided')}</dd></div>
        <div><dt>Company</dt><dd>${esc(l.company || 'Not provided')}${l.domain ? ` · ${esc(l.domain)}` : ''}</dd></div>
        ${l.location ? `<div><dt>Location</dt><dd>${esc(l.location)}</dd></div>` : ''}
        <div><dt>Added</dt><dd>${l.createdAt ? esc(new Date(l.createdAt).toLocaleDateString(undefined, { day: 'numeric', month: 'long', year: 'numeric' })) : 'Not recorded'}</dd></div>
      </dl>
      <section class="contact-draft">
        <h3>${g.subject ? 'Email draft' : 'Prepare the first introduction'}</h3>
        ${g.subject ? `<strong>${esc(g.subject)}</strong><p class="draft-preview">${esc(g.email1 || '')}</p><a class="btn small" href="#review" data-close data-review="${esc(l.id)}">Open in Review ${icon('arrow')}</a>` : '<p class="note">Select this person on Leads and choose Write emails to research them and write a personal introduction.</p>'}
      </section>
      ${l.outreach?.status ? `<section class="contact-draft"><h3>Outreach</h3><p class="note">${esc(cap(l.outreach.status))}${l.outreach.replySummary ? `: ${esc(l.outreach.replySummary)}` : ''}</p></section>` : ''}
    </div>
    <div class="drawer-bottom"><button class="link subtle" data-act="delete" data-id="${esc(l.id)}">Remove from leads</button><span>Adds them to do not contact</span></div>`;
  drawer.showModal();
}

// ---------- review ----------
const REVIEW_RANK = { ready: 0, writing: 1, error: 2, approved: 3, queued: 4 };
const reviewList = () => state.leads
  .filter((l) => l.gen?.status && l.gen.status !== 'idle' && !l.outreach?.email1)
  .sort((a, b) => (REVIEW_RANK[stage(a).key] ?? 5) - (REVIEW_RANK[stage(b).key] ?? 5) || a.createdAt - b.createdAt);

function queueItem(l) {
  const s = stage(l);
  return `<button class="queue-item${l.id === reviewId ? ' is-current' : ''}" data-act="review-pick" data-id="${esc(l.id)}" aria-current="${l.id === reviewId}">
    <span class="qi-top">${avatar(l)}<span class="person-text"><strong>${esc(l.fullName)}</strong><span>${esc(l.company || '')}</span></span></span>
    ${chip(s.key, s.label)}
  </button>`;
}

function reviewPaper(l) {
  const g = l.gen || {};
  const s = stage(l);
  const working = ['queued', 'running'].includes(g.status);
  const head = `
    <div class="paper-head">
      <div class="paper-who">${avatar(l)}<div><h2>${esc(l.fullName)}</h2><p class="paper-meta">${esc([l.title, l.company].filter(Boolean).join(' at '))}</p></div></div>
      ${chip(working ? 'writing' : s.key, working ? 'writing' : s.label)}
    </div>`;

  if (working && !g.subject) {
    return `<section class="panel paper">${head}<p class="note">Researching ${esc(l.company)} and writing the email and deck. Usually 2 to 3 minutes.</p><div class="writing-lines" aria-hidden="true"><i></i><i></i><i></i><i></i></div></section><aside class="context"></aside>`;
  }
  if (!g.subject) {
    return `<section class="panel paper">${head}<p class="error-box">That didn't work: ${esc(g.error || 'unknown error')}</p>${cmd('Try again', `data-act="generate" data-id="${l.id}"`, 'primary')}</section><aside class="context"></aside>`;
  }

  const dis = working ? 'disabled' : '';
  const unit = state.settings.gapUnit === 'minutes' ? 'minutes' : 'days';
  const sources = (g.research?.sources || []).map((u) => `<a href="${esc(u)}" target="_blank" rel="noopener">${esc(u.replace(/^https?:\/\/(www\.)?/, ''))}</a>`).join('');
  const asked = (l.comments || []).map((c) => `<li>You asked: ${esc(c.text)}</li>`).join('');
  return `
  <section class="panel paper" aria-label="Email for ${esc(l.fullName)}">
    ${head}
    ${hookLine(g)}
    ${working ? '<p class="note" style="margin-bottom:12px">Making your changes to the email and deck.</p>' : ''}
    ${g.error && !working ? '<p class="error-box">Your last change didn\'t go through. Try again.</p>' : ''}
    <div class="mail">
      <div class="mail-row"><b>To</b><span class="mono">${esc(l.email)}</span></div>
      <label class="mail-row"><b>Subject</b><textarea id="subject-${l.id}" class="mail-subject single" data-edit="subject" data-id="${l.id}" rows="1" ${dis}>${esc(g.subject)}</textarea></label>
      <textarea class="mail-body" data-edit="email1" data-id="${l.id}" rows="8" aria-label="Email to ${esc(l.fullName)}" ${dis}>${esc(g.email1)}</textarea>
    </div>
    <div class="followups">
      <div class="mail"><div class="mail-row"><b>Follow-up 1</b><span>${state.settings.gap1} ${unit} later, same thread</span></div><textarea class="mail-body" data-edit="followup1" data-id="${l.id}" rows="3" aria-label="Follow-up 1" ${dis}>${esc(g.followup1)}</textarea></div>
      <div class="mail"><div class="mail-row"><b>Follow-up 2</b><span>${state.settings.gap2} ${unit} after that</span></div><textarea class="mail-body" data-edit="followup2" data-id="${l.id}" rows="2" aria-label="Follow-up 2" ${dis}>${esc(g.followup2)}</textarea></div>
    </div>
  </section>
  <aside class="context">
    <div class="panel">
      <p class="ctx-title">Deck made for ${esc(l.company || 'them')}</p>
      <a class="deck-thumb" href="/decks/${esc(g.deckPath)}?v=${g.generatedAt}" target="_blank" rel="noopener"><img src="/decks/${l.id}-cover.png?v=${g.generatedAt}" alt="First page of the deck made for ${esc(l.company)}" onerror="this.remove()"></a>
      <a class="deck-link" href="/decks/${esc(g.deckPath)}?v=${g.generatedAt}" target="_blank" rel="noopener">Open the ${g.deckPages || 4}-page deck ${icon('arrow')}</a>
    </div>
    ${g.hookSource ? `<div class="panel"><p class="ctx-title">Why this angle</p><p class="note">${esc(g.hookSource)}</p><div class="sources">${sources}</div></div>` : ''}
    <div class="panel">
      <p class="ctx-title">Ask for a change</p>
      <textarea id="comment-${l.id}" rows="2" aria-label="What should change" placeholder="E.g. mention their new store launch" ${dis}></textarea>
      <div class="actions">${cmd('Update email and deck', `data-act="comment" data-id="${l.id}" ${dis}`, 'small')}</div>
      ${asked ? `<ul class="history">${asked}</ul>` : ''}
    </div>
    <div class="panel decide">
      ${l.approved
        ? `${chip('approved', 'approved')}<a class="btn block" href="#send">Go to Outreach</a><div class="decide-links"><button class="link subtle" data-act="approve" data-id="${l.id}" data-on="0">Undo approval</button><button class="link subtle" data-act="generate" data-id="${l.id}">Start over</button></div>`
        : `${cmd('Approve', `data-act="approve" data-id="${l.id}" data-on="1" ${dis}`, 'primary block')}<div class="decide-links"><span class="shortcuts"><span class="kbd">A</span> approve · <span class="kbd">J</span><span class="kbd">K</span> move</span><button class="link subtle" data-act="generate" data-id="${l.id}" ${dis}>Start over</button></div>`}
    </div>
  </aside>`;
}

function renderReview() {
  const leads = reviewList();
  if (!leads.length) {
    return `${heading('Review', 'Proofread each email and deck before anything goes out.')}<div class="panel">${emptyState('Nothing to review yet', 'Pick people on Leads and choose Write emails. Each one lands here with its deck.', `<a class="btn primary" href="#leads">Go to Leads</a>`)}</div>`;
  }
  if (!leads.some((l) => l.id === reviewId)) reviewId = leads[0].id;
  const current = leads.find((l) => l.id === reviewId);
  const ready = leads.filter((l) => stage(l).key === 'ready').length;
  return `
  ${heading('Review', 'Proofread each email and deck. Edit directly, or ask for a change.', { count: leads.length, actions: ready > 1 ? cmd(`Approve all ${ready}`, 'data-act="approve-all"') : '' })}
  <div class="review">
    <aside class="panel queue" aria-label="Review queue">
      <div class="queue-head"><span>Queue</span><span>${ready ? `${ready} to review` : 'All reviewed'}</span></div>
      ${leads.map(queueItem).join('')}
    </aside>
    ${reviewPaper(current)}
  </div>`;
}

// ---------- outreach ----------
function sendLine(l) {
  const o = l.outreach || {};
  const c = state.connections;
  const ended = o.status === 'replied' || o.status === 'bounced' || o.stopped;
  // The three steps always show, so the sequence is visible before anything goes out.
  const progress = `<span class="steps">${[['email1', 'Email'], ['followup1', 'Follow-up 1'], ['followup2', 'Follow-up 2']].map(([k, label]) => {
    if (o[k]) return `<span class="step done" title="Sent ${esc(when(o[k].sentAt))}"><i></i>${label}</span>`;
    if (k === 'email1' && o.queued) return `<span class="step next"><i></i>${label} · ${esc(sendTime(l.nextDue?.at))}</span>`;
    if (!ended && l.nextDue?.step === k) return `<span class="step next" title="Due ${esc(when(l.nextDue.at))}"><i></i>${label} · ${esc(when(l.nextDue.at))}</span>`;
    return `<span class="step"><i></i>${label}</span>`;
  }).join('')}</span>`;
  const label = state.settings.testMode ? 'Send preview' : 'Send now';
  // A teammate already owns this person, so the send is off here and the row says whose they are.
  const action = !o.email1 && !o.queued
    ? l.teamOwner
      ? `<span class="has-tip" title="${esc(teamMate(l.teamOwner))} on your team is already working with ${esc(l.fullName || l.email)}, so this laptop won't email them.">${cmd(label, 'disabled', 'small')}</span>`
      : cmd(label, `data-act="send-one" data-id="${l.id}" ${c.inbox ? '' : 'disabled'}`, 'small')
    : '';
  let status = chip('new', 'not sent');
  if (o.queued) status = chip('queued', 'queued');
  if (o.status === 'bounced') status = chip('bounced', 'bounced');
  else if (o.stopped) status = chip('not', 'stopped');
  else if (o.status === 'replied') status = o.temperature === 'hot' ? chip('interested', 'interested') : chip('not', 'not interested');
  else if (o.followup2) status = chip('not', 'no reply yet');
  else if (o.email1) status = chip('waiting', 'waiting for reply');
  if (o.email1?.test) status += '<span class="chip chip-preview">Preview</span>';
  const next = o.nextSteps || o.replySummary || (o.status === 'bounced' ? 'Added to do not contact.' : '') || (o.stopped ? `On do not contact: ${o.stopped}.` : '');
  return `<tr class="person-row">
    <td>${personButton(l, l.company || 'Company not provided')}</td>
    <td>${progress}</td>
    <td><span class="status-cell">${status}${withChip(l)}</span></td>
    <td class="next-cell">${next ? esc(next) : '<span class="cell-muted">Nothing yet</span>'}${o.lastError ? `<p class="error-box">Couldn't send: ${esc(o.lastError)}</p>` : ''}</td>
    <td class="cell-action">${action}</td>
  </tr>`;
}

function renderSend() {
  const s = state.settings;
  const c = state.connections;
  const leads = state.leads.filter((l) => l.approved || l.outreach?.email1);
  const unsent = leads.filter((l) => !l.outreach?.email1 && !l.outreach?.queued && !l.teamOwner).length;
  const unit = s.gapUnit === 'minutes' ? 'minutes' : 'days';
  const sending = state.sending || { sentToday: 0, cap: s.dailyCap, open: false, next: null };
  const preview = s.testMode;
  // The send button says exactly what will happen: previews to you, or real emails to people.
  const sendLabel = preview ? `Send ${plural(unsent, 'preview', 'previews')} to your inbox` : `Send to ${plural(unsent, 'person', 'people')}`;
  const nextSend = preview ? 'Previews go out as soon as you send them'
    : sending.open ? 'Sending hours are open now'
      : sending.next ? `Next sending window ${esc(sendTime(sending.next))}` : 'Sending hours never open';
  return `
  ${heading('Outreach', 'Emails go out from your Gmail. Follow-ups stop as soon as someone replies.', {
    count: leads.length,
    actions: `${cmd('Check for replies', `data-act="tick" ${c.inbox ? '' : 'disabled'}`)}${cmd(sendLabel, `data-act="send-approved" ${unsent && c.inbox ? '' : 'disabled'}`, 'primary')}`,
  })}
  ${c.inbox ? '' : '<p class="notice-bar">Connect Gmail before sending. <a href="#settings">Open Settings</a></p>'}
  <div class="panel plan">
    ${icon('clock')}
    <p><b>${plural(unsent, 'person', 'people')} ready to send</b><span>${sending.sentToday} of ${sending.cap} sent today</span><span>Sending hours ${esc(s.sendFrom)} to ${esc(s.sendTo)}, ${esc(s.timezone)}${s.weekends ? '' : ', weekdays'}</span><span>${nextSend}</span></p>
  </div>
  <div class="split">
    <div class="panel table-panel">
      <div class="panel-title"><h2>People in outreach</h2><span class="note">${plural(leads.length, 'person', 'people')}</span></div>
      ${leads.length ? `
      <div class="table-scroll" role="region" aria-label="Outreach table" tabindex="0">
        <table class="table stack-mobile">
          <caption class="sr-only">Outreach progress for each person</caption>
          <thead><tr><th scope="col">${th('person', 'Name')}</th><th scope="col">${th('steps', 'Sequence')}</th><th scope="col">${th('status', 'Status')}</th><th scope="col">${th('sparkle', 'Next step')}</th><th scope="col"><span class="sr-only">Action</span></th></tr></thead>
          <tbody>${leads.map(sendLine).join('')}</tbody>
        </table>
      </div>
      <div class="table-foot"><span>Showing ${plural(leads.length, 'person', 'people')}</span><span>Click a name to see details</span></div>`
      : emptyState('Nothing approved yet', 'Emails you approve on Review wait here until you send them.', `<a class="btn" href="#review">Go to Review</a>`)}
    </div>
    <section class="panel schedule" aria-label="Schedule">
      <div class="card-head"><div><h2>Schedule</h2><p>Real emails only go out inside your sending hours, one a minute.</p></div></div>
      <div class="setting-row"><label class="switch"><input type="checkbox" data-act="test-mode" ${s.testMode ? 'checked' : ''}><span>Preview mode</span></label><span class="hint-text">${s.testMode ? 'Emails come to your inbox' : 'Emails go to real people'}</span></div>
      <div class="setting-row"><span class="setting-label">First follow-up</span><span class="setting-controls"><input class="inline-num" data-setting="gap1" type="number" min="0" max="60" value="${s.gap1}" aria-label="Wait before the first follow-up"> ${unit} after</span></div>
      <div class="setting-row"><span class="setting-label">Second follow-up</span><span class="setting-controls"><input class="inline-num" data-setting="gap2" type="number" min="0" max="60" value="${s.gap2}" aria-label="Wait before the second follow-up"> ${unit} later</span></div>
      <div class="setting-row"><span class="setting-label">Sending hours</span><span class="setting-controls"><input class="inline-time" data-setting="sendFrom" type="time" value="${esc(s.sendFrom)}" aria-label="Start sending at"> to <input class="inline-time" data-setting="sendTo" type="time" value="${esc(s.sendTo)}" aria-label="Stop sending at"></span></div>
      <div class="setting-row"><span class="setting-label">Daily limit</span><span class="setting-controls"><input class="inline-num" data-setting="dailyCap" type="number" min="1" max="500" value="${s.dailyCap}" aria-label="Emails per day"> emails</span></div>
      <div class="setting-row"><label class="switch"><input type="checkbox" data-act="weekends" ${s.weekends ? 'checked' : ''}><span>Weekends too</span></label></div>
      ${s.testMode ? '' : `<p class="note schedule-note">${scheduleNote()}</p>`}
    </section>
  </div>`;
}

// ---------- team ----------
// One licence is one seat. Everyone keeps their own leads, drafts, keys and Claude Code on their own Mac.
// What meets here is the day's work: who added whom, what was written, and what went out.
const TEAM_STATUS = { new: 'new', writing: 'writing', 'to review': 'ready', approved: 'approved', queued: 'queued', sent: 'sent', interested: 'interested', 'not interested': 'not', bounced: 'bounced' };
const teamStatusChip = (s) => chip(TEAM_STATUS[s] || 'new', s || 'new');
const teamMate = (id) => (state.team?.members || []).find((m) => m.id === id)?.name || 'a teammate';
const teamOwnerName = () => (state.team?.members || []).find((m) => m.role === 'owner')?.name || 'your team owner';
const teamPeople = () => (state.team?.members || []).filter((m) => !m.removed);
// Totals are counted per person per day; this is today's row, or zeroes.
const totalsToday = (memberId) => {
  const day = new Date().toISOString().slice(0, 10);
  return (state.team?.totals || []).find((x) => x.memberId === memberId && x.day === day) || { leads: 0, drafts: 0, approved: 0, sent: 0, replies: 0 };
};
// Someone on the team already owns this person, so this laptop never emails them.
const withChip = (l) => (l.teamOwner
  ? `<span class="chip chip-plain" title="${esc(teamMate(l.teamOwner))} on your team is already working with ${esc(l.fullName || l.email)}, so this laptop won't email them.">With ${esc(teamMate(l.teamOwner))}</span>`
  : '');

function ago(ms) {
  if (!ms || Number.isNaN(ms)) return '';
  const diff = Date.now() - ms;
  if (diff < 45_000) return 'just now';
  const mins = Math.round(diff / 60_000);
  if (mins < 60) return `${plural(mins, 'minute', 'minutes')} ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${plural(hours, 'hour', 'hours')} ago`;
  const days = Math.round(hours / 24);
  if (days <= 7) return `${plural(days, 'day', 'days')} ago`;
  return `on ${new Date(ms).toLocaleDateString(undefined, { day: 'numeric', month: 'short' })}`;
}
function dayName(ms) {
  const day = new Date(ms).toDateString();
  if (day === new Date().toDateString()) return 'Today';
  if (day === new Date(Date.now() - 864e5).toDateString()) return 'Yesterday';
  return new Date(ms).toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long' });
}

// Who did what to whom, in plain words.
function eventSentence(e) {
  const who = e.memberId === state.team.memberId ? 'You' : esc(teamMate(e.memberId));
  const person = esc(e.leadName || e.leadEmail || 'someone');
  const at = e.company ? ` at ${esc(e.company)}` : '';
  return {
    lead_added: `${who} added ${person}${at}`,
    draft_written: `${who} wrote a draft for ${person}${at}`,
    draft_changed: `${who} changed the draft for ${person}${at}`,
    approved: `${who} approved the email to ${person}${at}`,
    email_sent: `${who} sent an email to ${person}${at}`,
    followup_sent: `${who} sent a follow-up to ${person}${at}`,
    reply_hot: `${person}${at} replied, interested`,
    reply_cold: `${person}${at} replied, not interested`,
    bounced: `The email to ${person}${at} bounced`,
    blocked: `${who} put ${person}${at} on do not contact`,
  }[e.type] || `${who} worked on ${person}${at}`;
}

function syncLine() {
  const t = state.team;
  const synced = t.syncedAt ? Date.parse(t.syncedAt) : null;
  const working = teamSyncing || t.pending;
  const kind = working ? ' is-syncing' : t.lastError ? ' is-error' : '';
  const text = working ? 'Syncing' : t.lastError ? esc(t.lastError) : synced ? `Synced ${esc(ago(synced))}` : 'Not synced yet. It runs by itself every minute.';
  return `<div class="sync-line${kind}"><span class="sync-text"><i></i>${text}</span>${cmd('Sync now', 'data-act="team-sync"', 'small')}</div>`;
}

function inviteBlock() {
  if (!inviteCode) return '';
  const until = Date.parse(inviteCode.expiresAt);
  return `
    <div class="invite-block">
      <div class="invite-main">
        <span class="invite-code">${esc(inviteCode.code)}</span>
        <p>Single use, expires in 7 days${until ? ` (${esc(new Date(until).toLocaleDateString(undefined, { day: 'numeric', month: 'long' }))})` : ''}. Send it to one teammate, who pastes it into Settings on their own Mac.</p>
      </div>
      ${cmd('Copy code', 'data-act="team-copy"', 'small')}
    </div>`;
}

const numCell = (label, n) => `<td class="num" data-label="${esc(label)}">${n ? n : '<span class="cell-muted">0</span>'}</td>`;

// One row per person with what they got done today, and when they were last at their desk.
function teamMembersTable() {
  const t = state.team;
  const owner = t.role === 'owner';
  const people = teamPeople();
  const rows = people.map((m) => {
    const n = totalsToday(m.id);
    const you = m.id === t.memberId;
    return `<tr>
      <td class="cell-person"><span class="person">${avatar({ fullName: m.name })}<span class="person-text"><strong>${esc(m.name)}</strong><span>${m.role === 'owner' ? 'Owner' : 'Member'}${you ? ' · you' : ''}</span></span></span></td>
      ${numCell('Leads', n.leads)}${numCell('Drafts', n.drafts)}${numCell('Approved', n.approved)}${numCell('Sent', n.sent)}${numCell('Replies', n.replies)}
      <td class="cell-seen" data-label="Last seen">${m.lastSeenAt ? esc(ago(Date.parse(m.lastSeenAt))) : '<span class="cell-muted">Not yet</span>'}</td>
      ${owner ? `<td class="cell-action">${you ? '' : `<button class="link subtle" data-act="team-remove" data-id="${esc(m.id)}">Remove</button>`}</td>` : ''}
    </tr>`;
  }).join('');
  return `
    <section class="panel table-panel">
      <div class="panel-title"><h2>Today</h2><span class="note">Leads added, drafts written, approved, emails sent, replies</span></div>
      <div class="table-scroll" role="region" aria-label="What each person did today" tabindex="0">
        <table class="table team-members">
          <caption class="sr-only">What each person on the team did today</caption>
          <thead><tr>
            <th scope="col">${th('person', 'Person')}</th>
            <th scope="col">Leads</th><th scope="col">Drafts</th><th scope="col">Approved</th><th scope="col">Sent</th><th scope="col">Replies</th>
            <th scope="col">${th('clock', 'Last seen')}</th>
            ${owner ? '<th scope="col"><span class="sr-only">Remove</span></th>' : ''}
          </tr></thead>
          <tbody>${rows}</tbody>
        </table>
      </div>
      ${people.length < 2 ? '<div class="table-foot"><span>No teammates yet. Invite someone with a code and their day shows up here.</span></div>' : ''}
    </section>`;
}

function teamLeadRow(l) {
  const mine = l.ownerId === state.team.memberId;
  return `<tr class="person-row" data-team-ref="${esc(l.ref)}">
    <td class="cell-person"><button class="person" data-act="open-team-lead" data-ref="${esc(l.ref)}">${avatar({ fullName: l.fullName })}<span class="person-text"><strong>${esc(l.fullName || 'Name not provided')}</strong><span>${esc(l.title || 'Role not provided')}</span></span></button></td>
    <td class="cell-company"><span class="company">${esc(l.company || 'Not provided')}</span>${l.domain ? `<span class="sub">${esc(l.domain)}</span>` : ''}</td>
    <td class="cell-email">${esc(l.email || 'Not provided')}</td>
    <td class="cell-status">${teamStatusChip(l.status)}</td>
    <td class="cell-with">${mine ? 'You' : esc(teamMate(l.ownerId))}</td>
    <td class="cell-activity"><span class="activity">${esc(ago(Date.parse(l.updatedAt)) || 'Not recorded')}</span></td>
    <td class="cell-open"><button class="icon-button" data-act="open-team-lead" data-ref="${esc(l.ref)}" aria-label="Open ${esc(l.fullName || l.email)}">${icon('arrow')}</button></td>
  </tr>`;
}

// Every teammate's people in one list, so the owner can see the whole pipeline without asking for it.
function teamPipeline() {
  const leads = [...(state.team.leads || [])].sort((a, b) => (Date.parse(b.updatedAt) || 0) - (Date.parse(a.updatedAt) || 0));
  return `
    <section class="panel table-panel">
      <div class="panel-title"><h2>Team pipeline</h2><span class="note">${plural(leads.length, 'person', 'people')}</span></div>
      ${leads.length ? `
      <div class="table-scroll" role="region" aria-label="Team pipeline" tabindex="0">
        <table class="table team-table">
          <caption class="sr-only">Every teammate's people</caption>
          <thead><tr>
            <th scope="col">${th('person', 'Name')}</th>
            <th scope="col">${th('building', 'Company')}</th>
            <th scope="col">${th('mail', 'Email')}</th>
            <th scope="col">${th('status', 'Status')}</th>
            <th scope="col">${th('person', 'With')}</th>
            <th scope="col">${th('clock', 'Last activity')}</th>
            <th scope="col"><span class="sr-only">Open</span></th>
          </tr></thead>
          <tbody>${leads.map(teamLeadRow).join('')}</tbody>
        </table>
      </div>
      <div class="table-foot"><span>Read only. Drafts stay on the laptop that wrote them.</span><span>Click a row to read the draft</span></div>`
      : emptyState('Nothing in the team pipeline yet', 'As soon as you or a teammate adds people, they show up here with their status and who is working them.')}
    </section>`;
}

function teamFeed() {
  const events = [...(state.team.events || [])]
    .map((e) => ({ ...e, ms: Date.parse(e.at) || 0 }))
    .sort((a, b) => b.ms - a.ms)
    .slice(0, 60);
  const days = [];
  for (const e of events) {
    const key = new Date(e.ms).toDateString();
    if (!days.length || days.at(-1).key !== key) days.push({ key, ms: e.ms, items: [] });
    days.at(-1).items.push(e);
  }
  const body = days.length
    ? days.map((d) => `
      <p class="feed-day">${esc(dayName(d.ms))}</p>
      <ul class="feed-list">${d.items.map((e) => `<li class="feed-item">${avatar({ fullName: teamMate(e.memberId) })}<span class="feed-text">${eventSentence(e)}</span><span class="feed-time">${esc(new Date(e.ms).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' }))}</span></li>`).join('')}</ul>`).join('')
    : '<p class="note feed-empty">No activity yet. Adding people, writing drafts and sending emails all show up here.</p>';
  return `
    <section class="panel feed-panel" aria-label="Team activity">
      <div class="panel-title"><h2>Activity</h2><span class="note">${state.team.role === 'owner' ? 'Everyone, last 14 days' : 'Your work, last 14 days'}</span></div>
      <div class="feed">${body}</div>
    </section>`;
}

function renderTeam() {
  const t = state.team;
  if (!t) {
    return `${heading('Team', 'Work one list with the people you hire, without sharing a login or a laptop.')}
    <div class="panel">${emptyState('This laptop is not on a team', 'Create a team, or join one with the code your owner sent you. Both are in Settings, under Work as a team.', '<a class="btn primary" href="#settings">Open Settings</a>')}</div>`;
  }
  const owner = t.role === 'owner';
  const people = teamPeople();
  const name = teamRenaming
    ? `<input id="team-name" class="heading-input" type="text" value="${esc(t.name)}" maxlength="80" aria-label="Team name">`
    : esc(t.name);
  const actions = !owner ? ''
    : teamRenaming
      ? `${cmd('Save name', 'data-act="team-rename-save"', 'primary small')}${cmd('Cancel', 'data-act="team-rename-cancel"', 'small')}`
      : `${cmd('Rename', 'data-act="team-rename"', 'small')}${cmd('Invite a teammate', 'data-act="team-invite"', 'primary')}`;
  const lede = owner
    ? "Everyone buys their own licence and works on their own Mac. You can read every teammate's leads and drafts; they see their own work plus the team totals."
    : `Your work syncs to ${esc(teamOwnerName())}'s team. You see your own leads and drafts, and what the team got done today.`;
  const me = totalsToday(t.memberId);
  return `
  ${heading(name, lede, { count: teamRenaming ? undefined : people.length, actions })}
  ${syncLine()}
  ${inviteBlock()}
  ${owner ? `
  <div class="team-stack">
    ${teamMembersTable()}
    ${teamPipeline()}
    ${teamFeed()}
  </div>`
  : `
  <div class="team-stack">
    <section class="panel">
      <div class="panel-title"><h2>Your day</h2><span class="note">${esc(new Date().toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long' }))}</span></div>
      <div class="team-counts">
        <span>Leads added<b>${me.leads}</b></span><span>Drafts written<b>${me.drafts}</b></span><span>Approved<b>${me.approved}</b></span><span>Emails sent<b>${me.sent}</b></span><span>Replies<b>${me.replies}</b></span>
      </div>
      <p class="note team-privacy">Your leads, drafts and activity are visible to ${esc(teamOwnerName())}. You can't see anyone else's list, only the totals below.</p>
    </section>
    <div class="split">${teamMembersTable()}${teamFeed()}</div>
  </div>`}`;
}

// The same drawer as a contact, with a teammate's draft in it, and nothing to edit or send.
function openTeamLead(ref) {
  const t = state.team;
  const l = (t?.leads || []).find((x) => x.ref === ref);
  if (!l) return;
  contactTrigger = null;
  const drawer = document.getElementById('contact-drawer');
  const mine = l.ownerId === t.memberId;
  const who = mine ? 'you' : teamMate(l.ownerId);
  // A member never receives someone else's draft, so the key isn't there at all.
  const canRead = 'draft' in l;
  const d = l.draft;
  const part = (label, text) => `<div class="draft-part"><h4>${label}</h4><p class="draft-preview">${esc(text || 'Nothing written yet')}</p></div>`;
  drawer.innerHTML = `
    <div class="drawer-top"><span>Team pipeline</span><button class="icon-button" data-close aria-label="Close this person">${icon('close')}</button></div>
    <div class="drawer-body">
      ${avatar({ fullName: l.fullName }, 'large')}
      <h2 id="contact-title">${esc(l.fullName || l.email)}</h2>
      <p class="contact-role">${esc([l.title, l.company].filter(Boolean).join(' at ') || 'Role not provided')}</p>
      <div class="status-cell">${teamStatusChip(l.status)}<span class="chip chip-plain">With ${esc(who)}</span></div>
      <p class="note read-only">Read only. ${mine ? 'This is your own work, as the team sees it.' : `${esc(who)} works this person on their own Mac.`}</p>
      <dl class="facts">
        <div><dt>Email address</dt><dd class="mono">${esc(l.email || 'Not provided')}</dd></div>
        <div><dt>Company</dt><dd>${esc(l.company || 'Not provided')}${l.domain ? ` · ${esc(l.domain)}` : ''}</dd></div>
        ${l.location ? `<div><dt>Location</dt><dd>${esc(l.location)}</dd></div>` : ''}
        <div><dt>Last activity</dt><dd>${esc(cap(ago(Date.parse(l.updatedAt)) || 'not recorded'))}</dd></div>
      </dl>
      <section class="contact-draft">
        <h3>Their draft</h3>
        ${!canRead ? `<p class="note">Only ${esc(teamOwnerName())} can read other people's drafts.</p>`
        : !d ? `<p class="note">No draft yet. ${mine ? 'You have' : `${esc(who)} has`} not written to this person.</p>`
        : `<p class="draft-subject"><b>Subject</b> ${esc(d.subject)}</p>
          ${part('Email', d.email1)}
          ${part('Follow-up 1', d.followup1)}
          ${part('Follow-up 2', d.followup2)}
          ${d.why ? `<div class="draft-part"><h4>Why this angle</h4><p class="note">${esc(d.why)}</p></div>` : ''}
          <p class="note">${d.deck ? 'A deck was made for this company and stays on' : 'No deck yet on'} ${mine ? 'this laptop' : `${esc(who)}'s laptop`}.${d.hookScore ? ` The opening scored ${esc(d.hookScore)} out of 10, from ${esc(HOOK_LABEL[d.hookTier] || d.hookTier || 'the website')}.` : ''}</p>`}
      </section>
    </div>
    <div class="drawer-bottom"><span>Nothing here can be edited or sent from this laptop.</span></div>`;
  drawer.showModal();
}

// The Settings card: how you get on a team, and what leaves this laptop once you are.
function teamSettingsCard() {
  const t = state.team;
  const privacy = "Leads, drafts and the day's activity sync to your team. API keys, Gmail details and deck files never leave this laptop.";
  if (!t) {
    return `
    <section class="panel int-card">
      <div class="int-head"><span class="int-icon">${icon('team')}</span><div><div class="int-title"><h2>Work as a team</h2></div>
        <p class="note">Everyone you hire buys their own licence and runs 4ruple on their own Mac, with their own Claude Code.
        Their leads, drafts and activity sync to the team, so the owner sees the day's work and two people never email the same person.</p></div></div>
      <div class="grid2">
        <label class="field"><span>new team name</span><input id="team-new-name" type="text" placeholder="Northlight Studio"></label>
        <label class="field"><span>or a team code</span><input id="team-code" type="text" placeholder="4T-XXXX-XXXX"></label>
      </div>
      <div class="actions">${cmd('Create a team', 'data-act="team-create"', 'primary small')}${cmd('Join with a code', 'data-act="team-join"', 'small')}</div>
      <p class="note int-foot">You show up to your team as ${esc(state.profile.senderName || 'the name on your licence')}. ${privacy}</p>
    </section>`;
  }
  const owner = t.role === 'owner';
  return `
    <section class="panel int-card">
      <div class="int-head"><span class="int-icon">${icon('team')}</span><div><div class="int-title"><h2>${esc(t.name)}</h2>${chip('done', owner ? 'owner' : 'member')}</div>
        <p class="note">${plural(teamPeople().length, 'person', 'people')} on this team, one licence each. <a href="#team">Open the team screen</a>.</p></div></div>
      ${syncLine()}
      ${inviteBlock()}
      <div class="actions">${owner ? cmd('Invite a teammate', 'data-act="team-invite"', 'primary small') : cmd('Leave the team', 'data-act="team-leave"', 'small')}</div>
      <p class="note int-foot">${owner
        ? "You can read every teammate's leads and drafts. They see their own work plus the team totals."
        : `Your leads, drafts and activity are visible to ${esc(teamOwnerName())}.`} ${privacy}</p>
    </section>`;
}

// ---------- settings ----------
function renderSettings() {
  const c = state.connections;
  const s = state.settings;
  const blocked = state.blocked || [];
  const connected = [['apollo', 'Apollo'], ['prospeo', 'Prospeo'], ['hunter', 'Hunter']].filter(([k]) => c[k]);
  const status = (on) => chip(on ? 'done' : 'new', on ? 'connected' : 'not connected');
  // Only the installed app has a license; running from the repo shows nothing here.
  const lic = state.license;
  const licenseCard = lic?.required ? `
    <section class="panel int-card">
      <div class="int-head"><span class="int-icon">${icon('key')}</span><div><div class="int-title"><h2>License</h2>${lic.offline ? chip('waiting', 'offline') : chip('done', 'active')}</div><p class="note">Key ending ${esc(lic.hint || '')}${lic.email ? `, bought with ${esc(lic.email)}` : ''}.${lic.maxDevices ? ` In use on ${lic.devicesUsed} of ${lic.maxDevices} devices.` : ''}</p></div></div>
      <p class="note">To use your key on another laptop, take this one off first. You can add it back any time.</p>
      <div class="actions">${cmd('Take this laptop off', 'data-act="license-deactivate"', 'small')}</div>
    </section>` : '';
  const provider = (letter, name, key, hint, on, placeholder) => `
    <div class="provider"><span class="int-icon letter" aria-hidden="true">${letter}</span>
      <label class="field"><span>${name} key <small>${hint}</small></span><input data-secret="${key}" type="password" autocomplete="off" placeholder="${on ? 'Saved' : placeholder}"></label>
    </div>`;
  return `
  ${heading('Settings', 'Connect Gmail and a lead search once. Everything else runs from your pipeline.')}
  <div class="integrations">
    <div class="int-col">
    <section class="panel int-card">
      <div class="int-head"><span class="int-icon">${icon('mail')}</span><div><div class="int-title"><h2>Gmail</h2>${status(c.inbox)}</div><p class="note">Emails are sent from this account. You need an <a href="https://myaccount.google.com/apppasswords" target="_blank" rel="noopener">app password</a>, and Google asks for 2-step verification first.</p></div></div>
      <div class="grid2">
        <label class="field"><span>gmail address</span><input data-secret="inboxEmail" type="email" autocomplete="off" placeholder="${esc(c.inboxEmail || 'you@gmail.com')}"></label>
        <label class="field"><span>app password</span><input data-secret="appPassword" type="password" autocomplete="off" placeholder="${c.inbox ? 'Saved' : '16 letters, like abcd efgh ijkl mnop'}"></label>
      </div>
      <div class="actions">${cmd('Save Gmail', 'data-act="save-secrets"', 'primary small')}${cmd('Test Gmail', `data-act="test-inbox" ${c.inbox ? '' : 'disabled'}`, 'small')}</div>
    </section>

    <section class="panel int-card">
      <div class="int-head"><span class="int-icon">${icon('search')}</span><div><div class="int-title"><h2>Lead search</h2>${status(c.apollo || c.prospeo || c.hunter)}</div><p class="note">Connect at least one. Apollo uses the credits on your own Apollo plan. Prospeo and Hunter have free plans.</p></div></div>
      ${provider('A', 'Apollo', 'apolloKey', 'your own Apollo account', c.apollo, 'From Apollo: settings, API keys')}
      ${provider('P', 'Prospeo', 'prospeoKey', 'finds people by team', c.prospeo, 'From prospeo.io')}
      ${provider('H', 'Hunter', 'hunterKey', 'finds people from a website', c.hunter, 'From hunter.io')}
      <div class="grid2 int-extra">
        <label class="field"><span>people per company</span><input data-setting="perCompany" type="number" min="1" max="25" value="${s.perCompany}"></label>
        ${connected.length > 1 ? `<label class="field"><span>search with</span><select data-setting="leadSource"><option value="auto" ${s.leadSource === 'auto' ? 'selected' : ''}>Whichever finds people first</option>${connected.map(([k, label]) => `<option value="${k}" ${s.leadSource === k ? 'selected' : ''}>${label} first</option>`).join('')}</select></label>` : ''}
      </div>
      <div class="actions">${cmd('Save keys', 'data-act="save-secrets"', 'primary small')}</div>
    </section>
    </div>
    <div class="int-col">
    ${licenseCard}
    ${teamSettingsCard()}
    <section class="panel int-card">
      <div class="int-head"><span class="int-icon">${icon('shield')}</span><div><div class="int-title"><h2>Do not contact</h2><span class="count">${blocked.length}</span></div><p class="note">Nobody here is ever added or emailed. People you remove, anyone who says no, and emails that bounce land here on their own.</p></div></div>
      <label class="field"><span>add emails or websites</span><textarea id="block-add" rows="2" placeholder="One per line, like name@brand.com or brand.com"></textarea></label>
      <div class="actions">${cmd('Add to list', 'data-act="block-add"', 'small')}</div>
      ${blocked.length ? `<details class="disclosure" data-detail="blocked" style="margin-top:14px"><summary>See the list (${blocked.length})</summary><ul class="history">${blocked.map((x) => `<li><span><span class="mono">${esc(x.value)}</span> · ${esc(x.label)}, ${when(x.at)}</span><button class="link subtle" data-act="unblock" data-id="${esc(x.value)}">Take off</button></li>`).join('')}</ul></details>` : ''}
    </section>

    <section class="panel int-card">
      <div class="int-head"><span class="int-icon">${icon('sliders')}</span><div><h2>Advanced</h2><p class="note">Test timing, and the time zone your sending hours use.</p></div></div>
      <label class="field"><span>follow-up timing in</span>
        <select data-setting="gapUnit"><option value="days" ${s.gapUnit === 'days' ? 'selected' : ''}>Days</option><option value="minutes" ${s.gapUnit === 'minutes' ? 'selected' : ''}>Minutes, for testing</option></select>
      </label>
      <label class="field"><span>time zone for sending hours</span><input data-setting="timezone" list="tz-list" value="${esc(s.timezone)}"></label>
      <datalist id="tz-list">${(Intl.supportedValuesOf?.('timeZone') || []).map((z) => `<option value="${z}">`).join('')}</datalist>
    </section>
    </div>
  </div>`;
}

// ---------- actions ----------
const collectProfile = () => {
  const root = document.getElementById('profile-form');
  const out = {};
  root.querySelectorAll('[data-key]').forEach((el) => { out[el.dataset.key] = el.value; });
  out.departments = [...root.querySelectorAll('input[name="departments"]:checked')].map((el) => el.value);
  out.seniority = [...root.querySelectorAll('input[name="seniority"]:checked')].map((el) => el.value);
  return out;
};
const clearProfileDrafts = () => clearDrafts('profile:', 'check:departments:', 'check:seniority:');
const confirmReal = (n) => state.settings.testMode || confirm(`Preview mode is off. This emails ${plural(n, 'person', 'people')} for real, during your sending hours. Send?`);

const actions = {
  'toggle-find': () => {
    const panel = document.getElementById('find-panel');
    panel.open = !panel.open;
    view.querySelector('.finder-anchor > [data-act="toggle-find"]')?.setAttribute('aria-expanded', String(panel.open));
    if (panel.open) {
      openDetails.add('find-panel');
      fitAreas(panel);
      (document.getElementById('find-companies') || document.getElementById('csv-file'))?.focus();
    } else openDetails.delete('find-panel');
  },
  // Blur first: render waits while a field has focus, and the company box is focused when the finder opens.
  'finder-mode': (btn) => { finderMode = btn.dataset.key; openDetails.add('find-panel'); document.activeElement?.blur(); render(); view.querySelector(`[data-act="finder-mode"][data-key="${finderMode}"]`)?.focus(); },
  'open-contact': (btn) => openContact(btn.dataset.id),
  'review-pick': (btn) => { reviewId = btn.dataset.id; render(); },
  'lead-view': (btn) => { leadView = btn.dataset.key; applyLeadFilters(); },
  'clear-selection': () => { view.querySelectorAll('[name="pick"]').forEach((el) => { el.checked = false; drafts.set(draftKey(el), false); }); updateSelection(); },
  'clear-filters': () => {
    leadQuery = ''; leadCompany = ''; leadView = 'all';
    document.getElementById('lead-search').value = '';
    document.getElementById('lead-company').value = '';
    drafts.delete('id:lead-search'); drafts.delete('id:lead-company');
    applyLeadFilters();
  },
  'save-profile': (btn) => run(btn, async () => {
    await api('/api/profile', collectProfile());
    clearProfileDrafts();
    toast('Saved');
    setTab('leads');
  }),
  autoread: (btn) => run(btn, async () => {
    // Save what's typed first, so nothing is lost if the read fails or takes a while.
    await api('/api/profile', collectProfile());
    clearProfileDrafts();
    toast('Reading your portfolio links. This takes a few minutes.');
    const r = await api('/api/profile/autoread', {});
    drafts.delete('profile:whatYouSolve');
    drafts.delete('profile:notableClients');
    const { proof = 0, unread = [] } = r.result || {};
    toast(unread.length
      ? `Found ${plural(proof, 'piece of work', 'pieces of work')}. Couldn't read ${plural(unread.length, 'link', 'links')}: ${unread[0]}`
      : `Found ${plural(proof, 'piece of work', 'pieces of work')}. Check what you solve and edit anything that's off.`, unread.length ? 'error' : 'ok');
  }),
  find: (btn) => run(btn, async () => {
    const c = state.connections;
    if (!c.apollo && !c.prospeo && !c.hunter) throw new Error('Connect lead search in Settings first, or import a CSV of people.');
    const companies = document.getElementById('find-companies').value;
    if (!companies.trim()) throw new Error('Add at least one company first');
    toast('Finding people. This can take a minute.');
    const r = await api('/api/leads/find', { companies });
    const { added = 0, skipped = {}, source, errors = [] } = r.result;
    const s = r.result.stats || {};
    const why = [
      skipped.blocked && `${skipped.blocked} on your do-not-contact list`,
      skipped.overLimit && `${skipped.overLimit} over your limit of ${state.settings.perCompany} per company`,
      skipped.duplicate && `${skipped.duplicate} already in your list`,
    ].filter(Boolean);
    if (added) {
      drafts.delete('id:find-companies');
      openDetails.delete('find-panel');
      toast(`Found ${plural(added, 'new person', 'new people')} with ${source}.${why.length ? ` Skipped ${why.join(', ')}.` : ''}`);
    } else if (why.length) {
      toast(`Nobody new. Skipped ${why.join(', ')}.`, 'error');
    } else if (s.stopped || s.emailError || errors.length) {
      toast(s.stopped || s.emailError || errors[0], 'error');
    } else if (s.found && !s.withEmail) {
      toast(`Found ${plural(s.found, 'person', 'people')}, but none had a verified email. Try company websites (like eggoz.in) instead of names, or add more companies.`, 'error');
    } else if (s.withEmail) {
      toast('Everyone found is already in your list.', 'error');
    } else {
      toast('Nobody matched in those teams. Try company websites (like eggoz.in) instead of names.', 'error');
    }
  }),
  'use-targets': () => {
    const box = document.getElementById('find-companies');
    box.value = icpCompanies(state.profile.icp).join('\n');
    drafts.set('id:find-companies', box.value);
    fitAreas(box.parentElement);
  },
  'generate-selected': (btn) => run(btn, async () => {
    const picked = [...document.querySelectorAll('input[name="pick"]:checked')].map((el) => el.value);
    if (!picked.length) throw new Error('Select at least one person');
    if (picked.some((id) => state.leads.find((l) => l.id === id)?.gen?.subject) && !confirm('Some selected people already have email drafts. Rewrite their emails and decks?')) return;
    const errors = [];
    for (const id of picked) await api(`/api/leads/${id}/generate`, {}).catch((e) => errors.push(e.message));
    clearDrafts('check:pick:');
    if (errors.length) toast(errors[0], 'error');
    else toast(`Writing ${plural(picked.length, 'email', 'emails')}. About 2 to 3 minutes each.`);
    setTab('review');
  }),
  generate: (btn) => run(btn, async () => {
    const lead = state.leads.find((l) => l.id === btn.dataset.id);
    if (lead?.gen?.subject && !confirm('Rewrite this email and deck from scratch? Your edits will be lost.')) return;
    await api(`/api/leads/${btn.dataset.id}/generate`, {});
  }),
  delete: (btn) => run(btn, async () => {
    await api(`/api/leads/${btn.dataset.id}/delete`, {});
    drafts.delete(`check:pick:${btn.dataset.id}`);
    toast("Removed. They won't be added or emailed again. Undo it in Settings, under Do not contact.");
  }),
  comment: (btn) => run(btn, async () => {
    const text = document.getElementById(`comment-${btn.dataset.id}`).value;
    await api(`/api/leads/${btn.dataset.id}/comment`, { text });
    drafts.delete(`id:comment-${btn.dataset.id}`);
  }),
  approve: (btn) => run(btn, async () => {
    const on = btn.dataset.on === '1';
    await api(`/api/leads/${btn.dataset.id}/approve`, { approved: on });
    // Approving moves the review on to the next draft that is waiting.
    if (on && tab === 'review') {
      const next = reviewList().find((l) => stage(l).key === 'ready' && l.id !== btn.dataset.id);
      if (next) reviewId = next.id;
      toast(next ? 'Approved. Next draft opened.' : 'Approved. Everything is reviewed.');
    }
  }),
  'approve-all': (btn) => run(btn, async () => {
    const ready = state.leads.filter((l) => stage(l).key === 'ready');
    for (const l of ready) await api(`/api/leads/${l.id}/approve`, { approved: true });
    toast(`Approved ${ready.length}. Head to Outreach when you're ready.`);
  }),
  'save-secrets': (btn) => run(btn, async () => {
    const body = {};
    document.querySelectorAll('[data-secret]').forEach((el) => { body[el.dataset.secret] = el.value; });
    const r = await api('/api/secrets', body);
    clearDrafts('secret:');
    toast(typeof r.result === 'string' ? r.result : 'Saved');
  }),
  'test-inbox': (btn) => run(btn, async () => { await api('/api/secrets/test-inbox', {}); toast('Gmail is connected'); }),
  'send-one': (btn) => run(btn, async () => {
    if (!confirmReal(1)) return;
    const r = await api(`/api/leads/${btn.dataset.id}/send`, {});
    if (r.result.live) toast(liveSendMessage(r.result), r.result.errors.length ? 'error' : 'ok');
    else toast('Sent to your inbox');
  }),
  'send-approved': (btn) => run(btn, async () => {
    const n = state.leads.filter((l) => stage(l).key === 'approved').length;
    if (!confirmReal(n)) return;
    const r = await api('/api/outreach/send-approved', {});
    if (r.result.live) toast(liveSendMessage(r.result), r.result.errors.length ? 'error' : 'ok');
    else if (r.result.errors.length) toast(`Sent ${r.result.sent}. Couldn't send ${r.result.errors.length}: ${r.result.errors[0]}`, 'error');
    else toast(`Sent ${r.result.sent} to your inbox`);
  }),
  'block-add': (btn) => run(btn, async () => {
    const r = await api('/api/blocked', { add: document.getElementById('block-add').value });
    drafts.delete('id:block-add');
    const { added, rejected } = r.result;
    toast(`Added ${plural(added, 'entry', 'entries')} to do not contact.${rejected.length ? ` Skipped: ${rejected[0]}.` : ''}`, rejected.length ? 'error' : 'ok');
  }),
  unblock: (btn) => run(btn, async () => {
    await api('/api/blocked/remove', { value: btn.dataset.id });
    toast('Taken off the list. Searches can add them again.');
  }),
  'open-team-lead': (btn) => openTeamLead(btn.dataset.ref),
  'team-create': (btn) => run(btn, async () => {
    const name = document.getElementById('team-new-name').value.trim();
    if (!name) throw new Error('Give your team a name first');
    await api('/api/team/create', { name });
    drafts.delete('id:team-new-name');
    toast('Team created. Invite your first teammate with a code.');
    setTab('team');
  }),
  'team-join': (btn) => run(btn, async () => {
    const code = document.getElementById('team-code').value.trim();
    if (!code) throw new Error('Paste the team code your owner sent you');
    await api('/api/team/join', { code, name: state.profile.senderName });
    drafts.delete('id:team-code');
    toast('You are on the team. Your leads, drafts and activity sync from now on.');
    setTab('team');
  }),
  'team-invite': (btn) => run(btn, async () => {
    const r = await api('/api/team/invite', {});
    inviteCode = { code: r.result.code, expiresAt: r.result.expiresAt };
    toast('Invite code ready. It works once.');
  }),
  'team-copy': () => {
    const code = inviteCode?.code;
    const copying = code && navigator.clipboard?.writeText(code);
    if (!copying) return toast('Select the code and copy it by hand', 'error');
    copying.then(() => toast('Invite code copied')).catch(() => toast('Select the code and copy it by hand', 'error'));
  },
  'team-rename': () => { teamRenaming = true; render(); document.getElementById('team-name')?.focus(); },
  'team-rename-cancel': () => { teamRenaming = false; drafts.delete('id:team-name'); render(); },
  'team-rename-save': (btn) => run(btn, async () => {
    const name = document.getElementById('team-name').value.trim();
    if (!name) throw new Error('Give the team a name');
    await api('/api/team/rename', { name });
    teamRenaming = false;
    drafts.delete('id:team-name');
    toast('Team renamed');
  }),
  'team-remove': (btn) => run(btn, async () => {
    const name = teamMate(btn.dataset.id);
    if (!confirm(`Remove ${name} from the team? Their own leads and drafts stay on their laptop, and stop syncing with you.`)) return;
    await api('/api/team/remove', { memberId: btn.dataset.id });
    toast(`${name} is off the team`);
  }),
  'team-leave': (btn) => run(btn, async () => {
    if (!confirm('Leave this team? Your leads and drafts stay on this laptop, and stop syncing with your team.')) return;
    await api('/api/team/leave', {});
    toast('You have left the team. Nothing syncs from this laptop now.');
    setTab('settings');
  }),
  'team-sync': (btn) => run(btn, async () => {
    teamSyncing = true;
    render();
    try { await api('/api/team/sync', {}); toast('Synced with your team'); } finally { teamSyncing = false; }
  }),
  'license-deactivate': (btn) => run(btn, async () => {
    if (!confirm('Take this laptop off your license? 4ruple will ask for your key again here.')) return;
    const r = await postJson('/api/license/deactivate', {});
    if (!r.ok) throw new Error(r.error);
    // The next state call answers 402, which brings up the key screen.
    await api('/api/state').catch(() => {});
  }),
  tick: (btn) => run(btn, async () => {
    const r = await api('/api/outreach/tick', {});
    if (r.result.errors?.length) toast(r.result.errors[0], 'error');
    else toast(r.result.replies ? plural(r.result.replies, 'new reply', 'new replies') : 'No new replies');
  }),
};

// ---------- events ----------
document.getElementById('tabs').addEventListener('click', (e) => {
  const b = e.target.closest('[data-tab]');
  if (b) setTab(b.dataset.tab);
});
window.addEventListener('hashchange', () => setTab(location.hash.slice(1)));

view.addEventListener('input', (e) => {
  if (e.target.id === 'lead-search') { leadQuery = e.target.value; applyLeadFilters(); }
  if (e.target.tagName === 'TEXTAREA') fitAreas(e.target.parentElement);
  const k = draftKey(e.target);
  if (k) drafts.set(k, e.target.type === 'checkbox' ? e.target.checked : e.target.value);
});

// One-line fields wrap long values visually but never take a real line break.
view.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && e.target.classList?.contains('single')) e.preventDefault();
});

// Review shortcuts: J and K move through the queue, A approves the open draft.
document.addEventListener('keydown', (e) => {
  if (tab !== 'review' || editing() || e.metaKey || e.ctrlKey || e.altKey || document.getElementById('contact-drawer').open) return;
  const items = [...view.querySelectorAll('.queue-item')];
  const i = items.findIndex((b) => b.dataset.id === reviewId);
  if ((e.key === 'j' || e.key === 'ArrowDown') && i < items.length - 1) { reviewId = items[i + 1].dataset.id; render(); e.preventDefault(); }
  else if ((e.key === 'k' || e.key === 'ArrowUp') && i > 0) { reviewId = items[i - 1].dataset.id; render(); e.preventDefault(); }
  else if (e.key === 'a') {
    const b = view.querySelector('.decide [data-act="approve"][data-on="1"]');
    if (b && !b.disabled) { actions.approve(b); e.preventDefault(); }
  }
});

// The floating finder closes on a click outside it or on Escape.
const closeFinder = () => {
  const panel = document.getElementById('find-panel');
  if (!panel?.open) return false;
  panel.open = false;
  openDetails.delete('find-panel');
  view.querySelector('.finder-anchor > [data-act="toggle-find"]')?.setAttribute('aria-expanded', 'false');
  return true;
};
document.addEventListener('click', (e) => {
  if (!e.target.closest('.finder-anchor')) closeFinder();
});
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && closeFinder()) view.querySelector('.finder-anchor > [data-act="toggle-find"]')?.focus();
});

view.addEventListener('toggle', (e) => {
  const d = e.target.dataset?.detail;
  if (!d) return;
  if (e.target.open) { openDetails.add(d); fitAreas(e.target); } else openDetails.delete(d);
}, true);

view.addEventListener('click', (e) => {
  const el = e.target.closest('button[data-act]');
  if (el) return actions[el.dataset.act]?.(el);
  // Anywhere on a team pipeline row opens that person's drawer.
  const row = e.target.closest('tr[data-team-ref]');
  if (row) openTeamLead(row.dataset.teamRef);
});

async function saveSettings(extra = {}) {
  const body = { ...extra };
  document.querySelectorAll('[data-setting]').forEach((el) => { body[el.dataset.setting] = el.value; });
  const r = await api('/api/settings', body);
  clearDrafts('setting:');
  return r;
}

view.addEventListener('change', async (e) => {
  const el = e.target;
  try {
    if (el.id === 'lead-company') { leadCompany = el.value; applyLeadFilters();
    } else if (el.id === 'lead-sort') { leadSort = el.value; el.blur(); render();
    } else if (el.name === 'pick') { updateSelection();
    } else if (el.id === 'pick-all') {
      document.querySelectorAll('.person-row:not([hidden]) input[name="pick"]').forEach((p) => { p.checked = el.checked; drafts.set(draftKey(p), el.checked); });
      updateSelection();
    } else if (el.dataset.act === 'test-mode') {
      const r = await saveSettings({ testMode: el.checked });
      const cancelled = r.result?.cancelled || 0;
      toast(el.checked
        ? (cancelled ? `Preview mode on. ${plural(cancelled, 'queued email', 'queued emails')} won't go out; send again when you're ready.` : 'Preview mode on: emails come to you first')
        : 'Preview mode off: emails go to real people, during your sending hours. Anyone you previewed is ready to send for real.', el.checked ? 'ok' : 'error');
      render();
    } else if (el.dataset.act === 'weekends') {
      await saveSettings({ weekends: el.checked });
      toast(el.checked ? 'Sending on weekends too' : 'Sending on weekdays only');
      render();
    } else if (el.dataset.setting) {
      await saveSettings();
      toast('Saved');
    } else if (el.dataset.edit) {
      await api(`/api/leads/${el.dataset.id}/edit`, { [el.dataset.edit]: el.value });
      drafts.delete(draftKey(el));
      toast('Saved');
    } else if (el.id === 'csv-file' && el.files[0]) {
      const file = el.files[0];
      const r = await api('/api/leads/csv', { csv: await file.text(), source: /apollo/i.test(file.name) ? 'Apollo CSV' : 'CSV' });
      toast(r.result.added ? `Added ${plural(r.result.added, 'person', 'people')}` : 'No new people in that file. It needs an Email column.', r.result.added ? 'ok' : 'error');
      render();
    }
  } catch (err) {
    toast(err.message, 'error');
    render();
  }
});

const catchUp = () => { if (renderPending) render(); };
view.addEventListener('focusout', () => setTimeout(catchUp, 150));
document.addEventListener('pointerdown', () => { pointerDown = true; });
// The click fires after pointerup, so catch up on the next tick, once the click has been handled.
for (const type of ['pointerup', 'pointercancel']) {
  document.addEventListener(type, () => { pointerDown = false; setTimeout(catchUp, 0); });
}
window.addEventListener('resize', () => fitAreas());

const contactDrawer = document.getElementById('contact-drawer');
contactDrawer.addEventListener('click', (e) => {
  const reviewLink = e.target.closest('[data-review]');
  if (reviewLink) reviewId = reviewLink.dataset.review;
  if (e.target.closest('[data-close]')) contactDrawer.close();
  const button = e.target.closest('button[data-act]');
  if (button) { contactDrawer.close(); actions[button.dataset.act]?.(button); }
  if (e.target === contactDrawer && e.clientX < contactDrawer.getBoundingClientRect().left) contactDrawer.close();
});
contactDrawer.addEventListener('close', () => {
  if (renderPending) render();
  view.querySelector(`[data-act="open-contact"][data-id="${CSS.escape(contactTrigger || '')}"]`)?.focus();
});
document.querySelector('.skip-link').addEventListener('click', (e) => { e.preventDefault(); view.focus(); });

// ---------- license ----------
// The installed app (npx 4ruple) asks for a key before anything else; the server answers 402 until one is active.
const licenseGate = document.getElementById('license-gate');
let licenseInfo = null;
let pendingKey = '';
let pendingEmail = '';
const BUY_URL = 'https://basementprotocol.com/4ruple';
const PLATFORMS = { darwin: 'Mac', win32: 'Windows', linux: 'Linux' };

function showLicenseGate(info) {
  licenseInfo = info;
  document.body.classList.add('locked');
  licenseGate.hidden = false;
  const devices = info.code === 'DEVICE_LIMIT' && info.devices?.length ? `
    <div class="gate-devices">
      <ul>${info.devices.map((d) => `<li>
        <span><strong>${esc(d.name)}</strong><small>${esc(PLATFORMS[String(d.platform).split('-')[0]] || 'Device')}${d.lastSeen ? `, last used ${esc(when(Date.parse(d.lastSeen)))}` : ''}</small></span>
        <button type="button" class="btn small" data-remove-device="${esc(d.id)}">Remove</button>
      </li>`).join('')}</ul>
      <p class="note">Removing one signs it out of 4ruple and uses this laptop instead.</p>
    </div>` : '';
  const showError = info.code && info.code !== 'NO_KEY';
  licenseGate.innerHTML = `
  <div class="gate-card">
    ${document.querySelector('.sidebar .lockup').outerHTML}
    <h1 id="license-title">Add your licence key</h1>
    <p class="lede">Your key and the address it was sent to are both in your purchase email.</p>
    <form class="gate-form" novalidate>
      <label class="field"><span>Licence key</span><input id="license-key" autocomplete="off" autocapitalize="characters" spellcheck="false" placeholder="4R-XXXXX-XXXXX-XXXXX-XXXXX" value="${esc(pendingKey)}"></label>
      <label class="field"><span>Email you bought with</span><input id="license-email" type="email" autocomplete="email" spellcheck="false" placeholder="you@company.com" value="${esc(pendingEmail)}"></label>
      ${showError ? `<p class="gate-error" role="alert">${esc(info.error)}</p>` : ''}
      ${devices}
      <button class="btn primary block" type="submit">Activate on this laptop</button>
    </form>
    <p class="gate-foot">No key yet? <a href="${BUY_URL}" target="_blank" rel="noopener">Buy a licence</a>. Lost your key? Reply to your purchase email.</p>
  </div>`;
  const input = document.getElementById(pendingKey && !pendingEmail ? 'license-email' : 'license-key');
  input.focus();
  input.setSelectionRange(input.value.length, input.value.length);
}

function hideLicenseGate() {
  document.body.classList.remove('locked');
  licenseGate.hidden = true;
  licenseGate.innerHTML = '';
  licenseInfo = null;
  pendingKey = '';
  pendingEmail = '';
}

const postJson = (url, body) => fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }).then((r) => r.json());

licenseGate.addEventListener('submit', async (e) => {
  e.preventDefault();
  pendingKey = document.getElementById('license-key').value.trim();
  pendingEmail = document.getElementById('license-email').value.trim();
  if (!pendingKey) return showLicenseGate({ code: 'INVALID_KEY', error: 'Paste your licence key first.' });
  if (!pendingEmail) return showLicenseGate({ code: 'EMAIL_NEEDED', error: 'Add the email address you bought 4ruple with.' });
  const button = licenseGate.querySelector('button[type="submit"]');
  button.disabled = true;
  button.textContent = 'Checking your key';
  try {
    const r = await postJson('/api/license/activate', { key: pendingKey, email: pendingEmail });
    if (!r.ok) return showLicenseGate(r);
    hideLicenseGate();
    await api('/api/state');
    render();
    toast('4ruple is ready on this laptop');
  } catch {
    showLicenseGate({ code: 'OFFLINE', error: "Couldn't reach 4ruple. Check the Terminal window running it is still open." });
  }
});

licenseGate.addEventListener('click', async (e) => {
  const button = e.target.closest('[data-remove-device]');
  if (!button) return;
  button.disabled = true;
  button.textContent = 'Removing';
  try {
    const r = await postJson('/api/license/remove-device', { key: document.getElementById('license-key').value.trim(), deviceId: button.dataset.removeDevice });
    if (!r.ok) return showLicenseGate({ ...licenseInfo, error: r.error });
    licenseGate.querySelector('form').requestSubmit();
  } catch {
    showLicenseGate({ ...licenseInfo, error: "Couldn't reach 4ruple. Check the Terminal window running it is still open." });
  }
});

// ---------- polling ----------
async function poll() {
  try {
    await api('/api/state');
    render();
  } catch { /* server restarting */ }
  const writing = state && (state.queue.running || state.queue.waiting);
  setTimeout(poll, writing ? 3000 : 20000);
}
history.replaceState(null, '', `#${tab}`);
poll();
