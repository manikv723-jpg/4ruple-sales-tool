// Renders the personalised deck to HTML, then to PDF with headless Chrome. Four pages by default, plus any
// pages the sender asked for while reviewing (deck.extra).
// Pages 1 and 2 wear the prospect's brand colours and imagery; pages 3 and 4 are the sender's.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { DATA_DIR } from './store.js';
import { rgbOf } from './brand.js';

const CHROME = process.env.CHROME_BIN || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

function luminance(hex) {
  const [r, g, b] = rgbOf(hex).map((v) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function mix(a, b, t) {
  const x = rgbOf(a);
  const y = rgbOf(b);
  return `#${x.map((v, i) => Math.round(v + (y[i] - v) * t).toString(16).padStart(2, '0')).join('')}`;
}

const onColor = (hex) => (luminance(hex) > 0.4 ? '#111111' : '#ffffff');

export function palette(brand) {
  const primary = brand.colors?.[0] || '#1d3557';
  const secondary = brand.colors?.[1] || mix(primary, '#000000', 0.45);
  const ink = luminance(primary) > 0.3 ? mix(primary, '#000000', 0.5) : primary;
  return { primary, secondary, ink, tint: mix(primary, '#ffffff', 0.9), onPrimary: onColor(primary), onSecondary: onColor(secondary) };
}

export function deckHtml({ lead, profile, content, brand }) {
  const c = palette(brand);
  const d = content.deck || {};
  const company = lead.company || lead.domain;
  const sender = profile.companyName || profile.senderName || 'Us';
  // Four fixed pages, plus any pages the sender asked for when reviewing.
  const extras = (d.extra || []).slice(0, 4);
  const total = 4 + extras.length;
  const foot = (n) => `<div class="foot"><span>${esc(sender)} for ${esc(company)}</span><span>${n} / ${total}</span></div>`;
  const logo = brand.logo ? `<img src="${esc(brand.logo)}" alt="">` : '';
  const image = brand.image ? `style="background-image:url('${esc(brand.image)}')"` : '';
  const steps = (d.solution?.steps || []).slice(0, 3);
  const work = (d.work?.items || []).slice(0, 4);
  const points = (d.problem?.points || []).slice(0, 3);

  return `<!doctype html><html><head><meta charset="utf-8">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;800&display=swap" rel="stylesheet">
<style>
@page { size: 1280px 720px; margin: 0; }
* { box-sizing: border-box; margin: 0; padding: 0; }
:root { --p: ${c.primary}; --s: ${c.secondary}; --ink: ${c.ink}; --tint: ${c.tint}; --on-p: ${c.onPrimary}; --on-s: ${c.onSecondary}; }
body { font-family: Inter, -apple-system, 'Helvetica Neue', Arial, sans-serif; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
.page { width: 1280px; height: 720px; position: relative; overflow: hidden; break-after: page; }
.page:last-child { break-after: auto; }
.foot { position: absolute; left: 64px; right: 64px; bottom: 30px; display: flex; justify-content: space-between; font-size: 13px; letter-spacing: .05em; opacity: .65; }
h1, h2 { letter-spacing: -.02em; font-weight: 800; }

.cover { display: grid; grid-template-columns: 58% 42%; background: var(--p); color: var(--on-p); }
.cover .left { padding: 64px; display: flex; flex-direction: column; }
.logos { display: flex; align-items: center; gap: 14px; font-weight: 600; font-size: 18px; }
.logos img { height: 48px; width: 48px; object-fit: contain; background: #fff; border-radius: 12px; padding: 7px; }
.eyebrow { margin-top: auto; font-size: 15px; text-transform: uppercase; letter-spacing: .14em; opacity: .8; }
.cover h1 { font-size: 58px; line-height: 1.05; margin-top: 18px; }
.cover .sub { font-size: 22px; line-height: 1.45; margin: 22px 0 64px; opacity: .92; max-width: 620px; }
.cover .right { position: relative; display: flex; align-items: center; justify-content: center; padding: 64px 56px 84px; background: var(--s); overflow: hidden; }
.cover .right img { display: block; max-width: 100%; max-height: 100%; object-fit: contain; background: #fff; box-shadow: 0 18px 40px rgba(0, 0, 0, .28); }
.cover .right.empty::before { content: ''; position: absolute; width: 420px; height: 420px; border-radius: 50%; right: -90px; top: 140px; background: var(--p); opacity: .35; }

.problem { display: grid; grid-template-columns: 42% 58%; background: var(--tint); color: #141414; }
.problem .left { background: var(--s); color: var(--on-s); padding: 64px; display: flex; flex-direction: column; position: relative; overflow: hidden; }
.problem .left.has-image::before { content: ''; position: absolute; inset: 0; background-image: var(--img); background-size: cover; background-position: center; opacity: .16; }
.problem .foot { left: calc(42% + 72px); }
.problem .left > * { position: relative; }
.problem .kicker { font-size: 15px; text-transform: uppercase; letter-spacing: .14em; opacity: .8; }
.problem h2 { font-size: 46px; line-height: 1.08; margin-top: 16px; }
.problem .insight { margin-top: auto; margin-bottom: 56px; font-size: 21px; line-height: 1.45; border-left: 4px solid currentColor; padding-left: 18px; }
.problem .right { padding: 64px 72px 96px; display: flex; flex-direction: column; justify-content: center; gap: 30px; }
.point { display: grid; grid-template-columns: 70px 1fr; align-items: start; }
.point .n { font-size: 34px; font-weight: 800; color: var(--ink); line-height: 1.1; }
.point p { font-size: 24px; line-height: 1.4; }

.solution { background: #f6f5f1; color: #141414; padding: 64px; }
.solution .kicker, .work .kicker { font-size: 15px; text-transform: uppercase; letter-spacing: .14em; opacity: .6; }
.solution h2 { font-size: 50px; line-height: 1.06; margin-top: 14px; max-width: 980px; }
.steps { display: grid; grid-template-columns: repeat(3, 1fr); gap: 22px; margin-top: 44px; }
.step { background: #fff; border-radius: 18px; padding: 28px; min-height: 250px; border: 1px solid #e6e3da; }
.step .n { font-size: 14px; font-weight: 600; opacity: .5; }
.step h3 { font-size: 26px; margin-top: 12px; line-height: 1.15; }
.step p { font-size: 18px; line-height: 1.5; margin-top: 12px; color: #3a3a3a; }
.outcome { margin-top: 26px; background: #141414; color: #fff; border-radius: 14px; padding: 20px 28px; font-size: 21px; line-height: 1.4; }

.work { background: #111; color: #f2f2f2; padding: 64px; }
.work h2 { font-size: 48px; margin-top: 14px; }
.items { display: grid; grid-template-columns: repeat(2, 1fr); gap: 18px; margin-top: 36px; }
.item { border: 1px solid #333; border-radius: 16px; padding: 22px 26px; }
.item .client { font-size: 24px; font-weight: 800; }
.item .what { font-size: 18px; line-height: 1.45; margin-top: 8px; color: #cfcfcf; }
.item .result { font-size: 16px; margin-top: 10px; color: #fff; font-weight: 600; }
.cta { position: absolute; left: 64px; right: 64px; bottom: 76px; display: flex; align-items: center; justify-content: space-between; gap: 24px; }
.cta p { font-size: 24px; font-weight: 600; max-width: 760px; line-height: 1.35; }
.cta a { background: #fff; color: #111; text-decoration: none; font-weight: 800; font-size: 18px; padding: 16px 26px; border-radius: 999px; white-space: nowrap; }

/* Pages the sender asked for while reviewing. They follow the solution page, so the deck reads as one piece. */
.extra { background: #f6f5f1; color: #141414; padding: 64px; }
.extra .kicker { font-size: 15px; text-transform: uppercase; letter-spacing: .14em; opacity: .6; }
.extra h2 { font-size: 50px; line-height: 1.06; margin-top: 14px; max-width: 980px; }
.extra .body { font-size: 21px; line-height: 1.5; margin-top: 20px; max-width: 900px; color: #3a3a3a; }
.extra ul { list-style: none; display: grid; gap: 14px; margin-top: 36px; max-width: 1000px; }
.extra li { background: #fff; border: 1px solid #e6e3da; border-radius: 14px; padding: 20px 24px; font-size: 20px; line-height: 1.45; }
</style></head><body>

<section class="page cover">
  <div class="left">
    <div class="logos">${logo}<span>${esc(company)}</span><span style="opacity:.6">x</span><span>${esc(sender)}</span></div>
    <div class="eyebrow">Prepared for ${esc(company)}${lead.firstName ? `, ${esc(lead.firstName)}` : ''}</div>
    <h1>${esc(d.cover?.headline)}</h1>
    <p class="sub">${esc(d.cover?.subhead)}</p>
  </div>
  <div class="right${brand.image ? '' : ' empty'}">${brand.image ? `<img src="${esc(brand.image)}" alt="">` : ''}</div>
  ${foot(1)}
</section>

<section class="page problem">
  <div class="left${brand.image ? ' has-image' : ''}" ${brand.image ? `style="--img:url('${esc(brand.image)}')"` : ''}>
    <div class="kicker">What we see at ${esc(company)}</div>
    <h2>${esc(d.problem?.title)}</h2>
    <p class="insight">${esc(d.problem?.insight)}</p>
  </div>
  <div class="right">
    ${points.map((p, i) => `<div class="point"><span class="n">0${i + 1}</span><p>${esc(p)}</p></div>`).join('')}
  </div>
  ${foot(2)}
</section>

<section class="page solution">
  <div class="kicker">How ${esc(sender)} solves it</div>
  <h2>${esc(d.solution?.title)}</h2>
  <div class="steps">
    ${steps.map((s, i) => `<div class="step"><div class="n">Step ${i + 1}</div><h3>${esc(s.title)}</h3><p>${esc(s.detail)}</p></div>`).join('')}
  </div>
  ${d.solution?.outcome ? `<div class="outcome">${esc(d.solution.outcome)}</div>` : ''}
  ${foot(3)}
</section>

<section class="page work">
  <div class="kicker">Work we've done</div>
  <h2>${esc(d.work?.title)}</h2>
  <div class="items">
    ${work.map((w) => `<div class="item"><div class="client">${esc(w.client)}</div><div class="what">${esc(w.what)}</div>${w.result ? `<div class="result">${esc(w.result)}</div>` : ''}</div>`).join('')}
  </div>
  <div class="cta"><p>${esc(d.work?.cta)}</p>${profile.calendly ? `<a href="${esc(profile.calendly)}">Book a call</a>` : ''}</div>
  ${foot(4)}
</section>
${extras.map((x, i) => `
<section class="page extra">
  <div class="kicker">More for ${esc(company)}</div>
  <h2>${esc(x.title)}</h2>
  ${x.body ? `<p class="body">${esc(x.body)}</p>` : ''}
  ${(x.bullets || []).length ? `<ul>${(x.bullets || []).slice(0, 3).map((b) => `<li>${esc(b)}</li>`).join('')}</ul>` : ''}
  ${foot(5 + i)}
</section>`).join('')}
</body></html>`;
}

function printPdf(htmlFile, pdfFile) {
  return new Promise((resolve, reject) => {
    const profileDir = fs.mkdtempSync(path.join(os.tmpdir(), 'salestool-chrome-'));
    const child = spawn(CHROME, [
      '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
      '--no-pdf-header-footer', '--run-all-compositor-stages-before-draw', '--virtual-time-budget=9000',
      `--user-data-dir=${profileDir}`, `--print-to-pdf=${pdfFile}`, `file://${htmlFile}`,
    ], { stdio: 'ignore' });
    const timer = setTimeout(() => child.kill('SIGKILL'), 45000);
    child.on('error', (e) => { clearTimeout(timer); reject(new Error(`Chrome failed to start: ${e.message}`)); });
    child.on('close', () => {
      clearTimeout(timer);
      fs.rmSync(profileDir, { recursive: true, force: true });
      if (fs.existsSync(pdfFile) && fs.statSync(pdfFile).size > 1000) resolve();
      else reject(new Error('Chrome did not produce the PDF'));
    });
  });
}

export async function renderDeck({ lead, profile, content, brand }) {
  const dir = path.join(DATA_DIR, 'decks');
  const htmlFile = path.join(dir, `${lead.id}.html`);
  const pdfFile = path.join(dir, `${lead.id}.pdf`);
  fs.writeFileSync(htmlFile, deckHtml({ lead, profile, content, brand }));
  fs.rmSync(pdfFile, { force: true });
  await printPdf(htmlFile, pdfFile);
  await renderCover(pdfFile, path.join(dir, lead.id));
  return `${lead.id}.pdf`;
}

// The Review screen shows the deck's first page, so it's rendered to an image next to the PDF.
function renderCover(pdfFile, outBase) {
  return new Promise((resolve) => {
    const child = spawn(process.env.PDFTOPPM_BIN || 'pdftoppm', ['-png', '-r', '60', '-f', '1', '-l', '1', '-singlefile', pdfFile, `${outBase}-cover`], { stdio: 'ignore' });
    child.on('error', () => resolve(false));
    child.on('close', (code) => resolve(code === 0));
  });
}
