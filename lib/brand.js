// Pulls the prospect's brand colours, imagery, logo and homepage copy from their website.

const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0 Safari/537.36';

async function fetchText(url, timeoutMs = 9000) {
  const res = await fetch(url, { headers: { 'User-Agent': UA, Accept: 'text/html,text/css,*/*' }, redirect: 'follow', signal: AbortSignal.timeout(timeoutMs) });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const text = await res.text();
  return { text: text.slice(0, 2_000_000), url: res.url };
}

function attrs(tag) {
  const out = {};
  for (const m of tag.matchAll(/([\w:-]+)\s*=\s*("([^"]*)"|'([^']*)'|([^\s>]+))/g)) {
    out[m[1].toLowerCase()] = m[3] ?? m[4] ?? m[5] ?? '';
  }
  return out;
}

const absolute = (href, base) => { try { return new URL(href, base).href; } catch { return null; } };

function toHex(r, g, b) {
  return `#${[r, g, b].map((n) => Math.max(0, Math.min(255, Number(n))).toString(16).padStart(2, '0')).join('')}`;
}

function normHex(h) {
  let s = h.toLowerCase().replace('#', '');
  if (s.length === 3) s = [...s].map((c) => c + c).join('');
  return s.length === 6 ? `#${s}` : null;
}

export function rgbOf(hex) {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function hsl(hex) {
  const [r, g, b] = rgbOf(hex).map((v) => v / 255);
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  const s = max === min ? 0 : (max - min) / (1 - Math.abs(2 * l - 1));
  return { s, l };
}

// CSS framework defaults (Bootstrap 4/5) show up on many sites but aren't the brand.
const FRAMEWORK = new Set(['#007bff', '#28a745', '#dc3545', '#ffc107', '#17a2b8', '#6c757d', '#0d6efd', '#198754', '#0dcaf0', '#6610f2', '#6f42c1', '#e83e8c', '#d63384', '#fd7e14', '#20c997', '#343a40']);
const usable = (hex) => { const { s, l } = hsl(hex); return !FRAMEWORK.has(hex) && s >= 0.25 && l >= 0.12 && l <= 0.88; };

const decode = (s) => String(s || '')
  .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
  .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
  .replace(/&nbsp;/g, ' ').replace(/&quot;/g, '"').replace(/&rsquo;|&lsquo;|&apos;/g, "'")
  .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
const distance = (a, b) => { const x = rgbOf(a); const y = rgbOf(b); return Math.hypot(x[0] - y[0], x[1] - y[1], x[2] - y[2]); };

function rankColors(css, themeColor) {
  const counts = new Map();
  const bump = (hex, by = 1) => { if (hex && usable(hex)) counts.set(hex, (counts.get(hex) || 0) + by); };
  for (const m of css.matchAll(/#([0-9a-f]{6}|[0-9a-f]{3})\b/gi)) bump(normHex(m[0]));
  for (const m of css.matchAll(/rgba?\(\s*(\d{1,3})[\s,]+(\d{1,3})[\s,]+(\d{1,3})/gi)) bump(toHex(m[1], m[2], m[3]));
  // Colours declared as brand/primary/accent variables or on buttons get extra weight.
  for (const m of css.matchAll(/(?:--[\w-]*(?:brand|primary|accent)[\w-]*|\.btn[\w-]*\s*\{[^}]*background(?:-color)?)\s*:\s*([^;}]+)/gi)) {
    const value = m[1];
    const hex = value.match(/#([0-9a-f]{6}|[0-9a-f]{3})\b/i);
    if (hex) bump(normHex(hex[0]), 25);
    const triple = value.match(/^\s*(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(\d{1,3})\s*$/) || value.match(/rgba?\(\s*(\d{1,3})[\s,]+(\d{1,3})[\s,]+(\d{1,3})/i);
    if (triple) bump(toHex(triple[1], triple[2], triple[3]), 25);
  }
  if (themeColor) bump(normHex(themeColor) || null, 1000);
  const ranked = [...counts.entries()].sort((a, b) => b[1] - a[1]).map(([hex]) => hex);
  const picked = [];
  for (const hex of ranked) {
    if (picked.every((p) => distance(p, hex) > 90)) picked.push(hex);
    if (picked.length === 3) break;
  }
  return picked;
}

function visibleText(html) {
  return html
    .replace(/<(script|style|noscript|svg|template)[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&#39;|&rsquo;/g, "'").replace(/&quot;/g, '"')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 2500);
}

export async function extractBrand(website, fallbackLogo = '') {
  const brand = { colors: [], image: null, logo: fallbackLogo || null, title: '', description: '', text: '', error: null };
  if (!website) { brand.error = 'No website for this lead'; return brand; }
  const start = /^https?:/i.test(website) ? website : `https://${website}`;
  try {
    const { text: html, url } = await fetchText(start);
    let themeColor = null;
    let icon = null;
    let touchIcon = null;
    for (const [tag] of html.matchAll(/<meta\b[^>]*>/gi)) {
      const a = attrs(tag);
      const key = (a.property || a.name || '').toLowerCase();
      if (key === 'theme-color') themeColor = a.content;
      if ((key === 'og:image' || key === 'twitter:image') && !brand.image) brand.image = absolute(a.content, url);
      if (key === 'og:title' && !brand.title) brand.title = decode(a.content);
      if ((key === 'description' || key === 'og:description') && !brand.description) brand.description = decode(a.content);
    }
    const cssHrefs = [];
    for (const [tag] of html.matchAll(/<link\b[^>]*>/gi)) {
      const a = attrs(tag);
      const rel = (a.rel || '').toLowerCase();
      if (rel.includes('stylesheet') && a.href) cssHrefs.push(absolute(a.href, url));
      if (rel.includes('apple-touch-icon') && a.href) touchIcon = absolute(a.href, url);
      else if (rel.split(/\s+/).includes('icon') && a.href) icon = absolute(a.href, url);
    }
    if (!brand.title) brand.title = decode(html.match(/<title[^>]*>([^<]*)<\/title>/i)?.[1] || '').trim();
    let css = [...html.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/gi)].map((m) => m[1]).join('\n');
    css += (html.match(/style="[^"]*"/gi) || []).join('\n');
    const sheets = await Promise.allSettled(cssHrefs.filter(Boolean).slice(0, 4).map((h) => fetchText(h, 6000)));
    for (const s of sheets) if (s.status === 'fulfilled') css += `\n${s.value.text}`;
    brand.colors = rankColors(css, themeColor);
    brand.logo = fallbackLogo || touchIcon || icon || null;
    brand.text = visibleText(html);
    if (!brand.logo) brand.logo = `https://www.google.com/s2/favicons?domain=${new URL(url).hostname}&sz=128`;
  } catch (e) {
    brand.error = `Couldn't read ${start}: ${e.message}`;
    try { brand.logo ||= `https://www.google.com/s2/favicons?domain=${new URL(start).hostname}&sz=128`; } catch { /* bad url */ }
  }
  return brand;
}
