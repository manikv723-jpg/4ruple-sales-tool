// Reads what a firm's portfolio links actually contain (Google Drive folders, Canva decks, websites),
// so the profile every email is written from rests on evidence the app has seen, not on guesses.
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0 Safari/537.36';
const CHROME = process.env.CHROME_BIN || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const MAX_TEXT = 12000;
const MAX_LINKS = 8;

const decode = (s) => String(s || '')
  .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
  .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
  .replace(/&nbsp;/g, ' ').replace(/&quot;/g, '"').replace(/&rsquo;|&lsquo;|&apos;/g, "'")
  .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');

const visibleText = (html) => decode(String(html)
  .replace(/<(script|style|noscript|svg|template)[\s\S]*?<\/\1>/gi, ' ')
  .replace(/<br\s*\/?>|<\/(p|div|li|h[1-6]|section|tr|span)>/gi, '\n')
  .replace(/<[^>]+>/g, ' '))
  .replace(/[ \t]+/g, ' ')
  .replace(/\s*\n\s*/g, '\n')
  .trim();

// Viewer chrome, page numbers and accessibility help that say nothing about the firm.
const BOILERPLATE = /^(skip (navigation|to main content|to end of page thumbnails)|back to start of page thumbnails|canva editor|changes will be saved automatically|file|viewing|sign up|log in|sign in|side panel|page thumbnails|share|present|zoom|help|notes|duration|pages|canvas|\d+|\d+\s*\/\s*\d+)$/i;
const HELP_TEXT = /(press enter|press tab|arrow keys|⌘|⇧|toolbar|selection inside the canvas|the canvas is where|main navigation|keyboard shortcut|hide page thumbnails|go to page|grid view|present full screen|this button opens|share and print your design|\bbackground$)/i;

function tidy(text) {
  const seen = new Set();
  const kept = [];
  for (const raw of text.split('\n')) {
    const line = raw.trim();
    if (line.length < 2 || BOILERPLATE.test(line) || HELP_TEXT.test(line)) continue;
    // Slide text often arrives a word or two per line; stitch those fragments back into phrases.
    const prev = kept[kept.length - 1];
    const fragment = line.split(/\s+/).length <= 3 || /^[,.;:)]/.test(line);
    if (prev && fragment && prev.length < 90 && !/[.!?:]$/.test(prev)) {
      kept[kept.length - 1] = `${prev}${/^[,.;:)]/.test(line) ? '' : ' '}${line}`;
      continue;
    }
    const key = line.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    kept.push(line);
  }
  return kept.join('\n').slice(0, MAX_TEXT);
}

async function fetchPage(url, ms = 15000) {
  const res = await fetch(url, { headers: { 'User-Agent': UA, Accept: 'text/html,*/*' }, redirect: 'follow', signal: AbortSignal.timeout(ms) });
  return { ok: res.ok, status: res.status, url: res.url, html: (await res.text()).slice(0, 3_000_000) };
}

// Pages that build themselves with JavaScript (Canva, many portfolio sites) only have text after rendering.
// Chrome can keep running after it has printed the DOM (Canva does), so the dump counts as done the moment
// the closing </html> arrives, and a dump cut off by the time limit is rejected instead of read half-empty.
function renderDom(url, { budget = 15000, timeoutMs = 60000 } = {}) {
  return new Promise((resolve, reject) => {
    const profileDir = fs.mkdtempSync(path.join(os.tmpdir(), 'salestool-read-'));
    const child = spawn(CHROME, [
      '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check', '--window-size=1440,900',
      `--user-data-dir=${profileDir}`, `--user-agent=${UA}`, `--virtual-time-budget=${budget}`, '--dump-dom', url,
    ], { stdio: ['ignore', 'pipe', 'ignore'] });
    let out = '';
    let settled = false;
    const complete = () => /<\/html>\s*$/i.test(out.slice(-400));
    const finish = (fn) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      child.kill('SIGKILL');
      setTimeout(() => { try { fs.rmSync(profileDir, { recursive: true, force: true }); } catch { /* Chrome still closing */ } }, 1000);
      fn();
    };
    const timer = setTimeout(() => finish(() => (complete() ? resolve(out) : reject(new Error('the page took too long to render')))), timeoutMs);
    child.stdout.on('data', (d) => { out += d; if (complete()) finish(() => resolve(out)); });
    child.on('error', (e) => finish(() => reject(new Error(`Chrome failed to start: ${e.message}`))));
    child.on('close', () => finish(() => (out ? resolve(out) : reject(new Error('the page did not render')))));
  });
}

const KINDS = [
  [/\.(mp4|mov|m4v|webm|avi|mkv)$/i, 'video'],
  [/\.(jpe?g|png|gif|webp|heic)$/i, 'image'],
  [/\.pdf$/i, 'pdf'],
  [/\.(pptx?|key)$/i, 'deck'],
  [/\.(docx?|txt)$/i, 'document'],
];
const cleanName = (n) => decode(n).replace(/\.[a-z0-9]{2,4}$/i, '').replace(/_+/g, ' ').replace(/\s{2,}/g, ' ').trim();

// Public Drive folders list their files on the embedded view, which needs no JavaScript or sign-in.
async function readDriveFolder(id, depth = 0) {
  const { ok, status, html } = await fetchPage(`https://drive.google.com/embeddedfolderview?id=${id}`);
  if (!ok) throw new Error(`Drive answered ${status}; the folder may not be shared publicly`);
  const entries = [...html.matchAll(/<div class="flip-entry"[\s\S]*?<a href="([^"]+)"[\s\S]*?flip-entry-title">([^<]*)</g)]
    .map((m) => ({ href: decode(m[1]), title: decode(m[2]) }));
  const items = [];
  for (const e of entries) {
    const sub = e.href.match(/\/folders\/([\w-]+)/);
    if (sub && depth < 1) {
      try {
        const inner = await readDriveFolder(sub[1], depth + 1);
        items.push(...inner.map((f) => ({ ...f, name: `${cleanName(e.title)} / ${f.name}` })));
      } catch {
        items.push({ name: cleanName(e.title), kind: 'folder' });
      }
    } else {
      const kind = KINDS.find(([re]) => re.test(e.title));
      items.push({ name: cleanName(e.title), kind: kind ? kind[1] : sub ? 'folder' : 'file' });
    }
  }
  return items;
}

// Canva share links point at the editor, which blocks plain fetches; the view page renders without sign-in.
async function readCanva(url) {
  let target = url;
  if (/canva\.link\//i.test(url)) {
    const res = await fetch(url, { headers: { 'User-Agent': UA }, redirect: 'manual', signal: AbortSignal.timeout(15000) });
    target = res.headers.get('location') || url;
  }
  target = target.replace(/[?#].*$/, '').replace(/\/(edit|watch|present|view)\/?$/i, '');
  target = `${target.replace(/\/$/, '')}/view`;
  // Canva loads later slides lazily; a longer virtual clock lets the whole deck render.
  const html = await renderDom(target, { budget: 30000, timeoutMs: 170000 });
  const title = decode(html.match(/<title>([^<]*)<\/title>/i)?.[1] || '').replace(/\s+-\s+(Presentation|Document|Website|Canva)\b.*$/i, '').trim();
  const text = tidy(visibleText(html));
  if (text.length < 80) throw new Error("the deck showed no readable text; it may need sign-in or be image-only");
  return { title, text };
}

async function readPage(url) {
  let html = '';
  let finalUrl = url;
  try {
    const page = await fetchPage(url);
    if (page.ok) { html = page.html; finalUrl = page.url; }
  } catch { /* fall through to rendering */ }
  let text = tidy(visibleText(html));
  if (text.length < 400) {
    try {
      html = await renderDom(finalUrl);
      text = tidy(visibleText(html));
    } catch (e) {
      if (!text) throw e;
    }
  }
  if (!text) throw new Error('no readable text on the page');
  const title = decode(html.match(/<title[^>]*>([^<]*)<\/title>/i)?.[1] || '').trim();
  const description = decode(html.match(/<meta[^>]+(?:name|property)=["'](?:og:)?description["'][^>]+content=["']([^"']*)/i)?.[1] || '');
  return { title, description, text };
}

const linksIn = (v) => String(v || '').split(/[\s,]+/).map((s) => s.trim())
  .filter((s) => /^https?:\/\//i.test(s) || /^[\w-]+(\.[\w-]+)+(\/\S*)?$/.test(s))
  .map((s) => (/^https?:/i.test(s) ? s : `https://${s}`));

export async function collectPortfolio(links, website) {
  const urls = [...new Set([...linksIn(links), ...linksIn(website)])].slice(0, MAX_LINKS);
  return Promise.all(urls.map(async (url) => {
    try {
      const folder = url.match(/drive\.google\.com\/drive\/(?:u\/\d+\/)?folders\/([\w-]+)/);
      if (folder) {
        const items = await readDriveFolder(folder[1]);
        if (!items.length) throw new Error('no files were visible; the folder may not be shared publicly');
        return { url, kind: 'Google Drive folder', ok: true, items };
      }
      if (/canva\.(link|com)\//i.test(url)) return { url, kind: 'Canva deck', ok: true, ...(await readCanva(url)) };
      return { url, kind: 'web page', ok: true, ...(await readPage(url)) };
    } catch (e) {
      return { url, kind: 'link', ok: false, error: e.message };
    }
  }));
}

export function formatSources(sources) {
  if (!sources.length) return '(no links given)';
  return sources.map((s, i) => {
    const head = `### Source ${i + 1}: ${s.kind} (${s.url})`;
    if (!s.ok) return `${head}\nCould not be read: ${s.error}`;
    if (s.items) return `${head}\n${s.items.length} items, by file or folder name:\n${s.items.map((f) => `- ${f.name}${['file', 'folder'].includes(f.kind) ? '' : ` [${f.kind}]`}`).join('\n')}`;
    return `${head}\nTitle: ${s.title || '(none)'}${s.description ? `\nDescription: ${s.description}` : ''}\nText on the page:\n${s.text}`;
  }).join('\n\n');
}
