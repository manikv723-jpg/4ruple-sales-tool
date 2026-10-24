#!/usr/bin/env node
// npx 4ruple
// Checks this laptop has what 4ruple needs (Node, Chrome, Claude Code signed in), then starts the app and
// opens it in the browser. Everything the app saves lives in ~/.4ruple, never in the npx cache.
import fs from 'node:fs';
import os from 'node:os';
import net from 'node:net';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PKG = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
const HOME = process.env.FOURUPLE_HOME || path.join(os.homedir(), '.4ruple');
const DATA = path.join(HOME, 'data');
const WIN = process.platform === 'win32';

const argv = process.argv.slice(2);
const has = (flag) => argv.includes(flag);
const valueOf = (flag) => { const i = argv.indexOf(flag); return i >= 0 ? argv[i + 1] : undefined; };
const command = argv.find((a, i) => !a.startsWith('-') && argv[i - 1] !== '--port') || 'start';

const tty = process.stdout.isTTY && !process.env.NO_COLOR;
const paint = (code) => (s) => (tty ? `\x1b[${code}m${s}\x1b[0m` : String(s));
const bold = paint(1);
const dim = paint(2);
const green = paint(32);
const yellow = paint(33);
const red = paint(31);
const blue = paint(34);
const line = (mark, text, fix) => console.log(`  ${mark} ${text}${fix ? `\n      ${dim(fix)}` : ''}`);
const pass = (text, fix) => line(green('✓'), text, fix);
const note = (text, fix) => line(yellow('!'), text, fix);
const fail = (text, fix) => line(red('✗'), text, fix);
const header = () => console.log(`\n  ${bold('4ruple.ai')} ${dim(`by Basement Protocol  v${PKG.version}`)}\n`);

// ---------- checks ----------
function checkNode() {
  const [major, minor] = process.versions.node.split('.').map(Number);
  const good = major > 20 || (major === 20 && minor >= 11);
  if (good) pass(`Node.js ${process.versions.node}`);
  else fail(`Node.js ${process.versions.node} is too old.`, 'Install Node.js 22 from https://nodejs.org, then run npx 4ruple again.');
  return good;
}

function findChrome() {
  if (process.env.CHROME_BIN && fs.existsSync(process.env.CHROME_BIN)) return process.env.CHROME_BIN;
  const candidates = {
    darwin: [
      '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
      path.join(os.homedir(), 'Applications/Google Chrome.app/Contents/MacOS/Google Chrome'),
      '/Applications/Chromium.app/Contents/MacOS/Chromium',
      '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
    ],
    win32: [
      `${process.env.PROGRAMFILES}\\Google\\Chrome\\Application\\chrome.exe`,
      `${process.env['PROGRAMFILES(X86)']}\\Google\\Chrome\\Application\\chrome.exe`,
      `${process.env.LOCALAPPDATA}\\Google\\Chrome\\Application\\chrome.exe`,
      `${process.env['PROGRAMFILES(X86)']}\\Microsoft\\Edge\\Application\\msedge.exe`,
    ],
    linux: ['google-chrome', 'google-chrome-stable', 'chromium', 'chromium-browser', 'microsoft-edge'],
  }[process.platform] || [];
  for (const candidate of candidates) {
    if (path.isAbsolute(candidate)) {
      if (fs.existsSync(candidate)) return candidate;
    } else {
      const found = spawnSync('which', [candidate], { encoding: 'utf8' });
      if (found.status === 0 && found.stdout.trim()) return found.stdout.trim();
    }
  }
  return null;
}

function checkChrome() {
  const chrome = findChrome();
  if (chrome) pass(`Browser for decks: ${path.basename(chrome).replace(/\.exe$/i, '')}`);
  else fail('Google Chrome not found. 4ruple uses it to turn each deck into a PDF.', 'Install it from https://www.google.com/chrome, or set CHROME_BIN to where Chrome is.');
  return chrome;
}

function checkClaude() {
  const bin = process.env.CLAUDE_BIN || 'claude';
  const run = (args) => spawnSync(bin, args, { encoding: 'utf8', shell: WIN, timeout: 20_000 });
  const version = run(['--version']);
  if (version.error || version.status !== 0) {
    fail('Claude Code is not installed. 4ruple writes every email and deck with it.', 'Install it: npm install -g @anthropic-ai/claude-code   then sign in: claude auth login');
    return false;
  }
  const v = version.stdout.trim().split(/\s+/)[0];
  let status = null;
  try { status = JSON.parse(run(['auth', 'status', '--json']).stdout); } catch { /* older Claude Code has no auth status */ }
  if (status && !status.loggedIn) {
    fail(`Claude Code ${v} is installed but not signed in.`, 'Sign in: claude auth login   then run npx 4ruple again.');
    return false;
  }
  if (status) pass(`Claude Code ${v}, signed in${status.subscriptionType ? ` (${status.subscriptionType} plan)` : ''}`);
  else note(`Claude Code ${v} found, but its sign-in couldn't be checked.`, 'If emails fail to write, run: claude auth login');
  return true;
}

function doctor() {
  const node = checkNode();
  const chrome = checkChrome();
  const claude = checkClaude();
  pass(`Your leads, keys and decks stay on this laptop in ${HOME.replace(os.homedir(), '~')}`);
  return { ready: node && !!chrome && claude, chrome };
}

// ---------- start ----------
const portIsFree = (port) => new Promise((resolve) => {
  const probe = net.createServer().once('error', () => resolve(false)).once('listening', () => probe.close(() => resolve(true)));
  probe.listen(port, '127.0.0.1');
});

async function isRunning(port) {
  try {
    const res = await fetch(`http://127.0.0.1:${port}/api/health`, { signal: AbortSignal.timeout(1500) });
    return (await res.json()).app === '4ruple';
  } catch {
    return false;
  }
}

function openBrowser(url) {
  if (has('--no-open')) return;
  const [cmd, args] = WIN ? ['cmd', ['/c', 'start', '', url]] : [process.platform === 'darwin' ? 'open' : 'xdg-open', [url]];
  try { spawn(cmd, args, { stdio: 'ignore', detached: true }).on('error', () => {}).unref(); } catch { /* the URL is printed anyway */ }
}

async function start() {
  header();
  const { ready, chrome } = doctor();
  console.log('');
  if (!ready && !has('--skip-checks')) {
    console.log(`  Fix the ${red('✗')} items above, then run ${bold('npx 4ruple')} again.\n`);
    process.exit(1);
  }

  const wanted = Number(valueOf('--port') || process.env.PORT || 4600);
  if (await isRunning(wanted)) {
    const url = `http://localhost:${wanted}`;
    console.log(`  4ruple is already running at ${blue(url)}\n`);
    openBrowser(url);
    return;
  }
  let port = wanted;
  while (!(await portIsFree(port))) {
    port += 1;
    if (port > wanted + 50) { fail(`No free port near ${wanted}. Try: npx 4ruple --port 5600`); process.exit(1); }
  }

  fs.mkdirSync(DATA, { recursive: true });
  const child = spawn(process.execPath, [path.join(ROOT, 'server.js')], {
    env: {
      ...process.env,
      PORT: String(port),
      FOURUPLE_DATA_DIR: DATA,
      FOURUPLE_REQUIRE_LICENSE: process.env.FOURUPLE_REQUIRE_LICENSE ?? '1',
      ...(chrome && { CHROME_BIN: chrome }),
    },
    stdio: ['ignore', 'ignore', 'inherit'],
  });
  for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => child.kill(signal));
  child.on('exit', (code) => process.exit(code ?? 0));

  const url = `http://localhost:${port}`;
  for (let i = 0; i < 80; i++) {
    if (await isRunning(port)) {
      console.log(`  ${green('4ruple is running at')} ${blue(url)}`);
      console.log(dim('  Keep this window open while you use it. Press Ctrl+C to stop.\n'));
      openBrowser(url);
      return;
    }
    await new Promise((r) => setTimeout(r, 250));
  }
  fail("4ruple didn't start. The message above says why.");
  child.kill();
  process.exit(1);
}

// ---------- other commands ----------
async function deactivate() {
  header();
  fs.mkdirSync(DATA, { recursive: true });
  process.env.FOURUPLE_DATA_DIR = DATA;
  process.env.FOURUPLE_REQUIRE_LICENSE = '1';
  const { deactivateThisDevice } = await import(pathToFileURL(path.join(ROOT, 'lib', 'license.js')).href);
  const r = await deactivateThisDevice();
  if (!r.ok) { fail(r.error); console.log(''); process.exit(1); }
  pass(r.removed ? 'This laptop is off your license. Your key has a free slot for another device.' : 'This laptop had no license on it.');
  console.log('');
}

function help() {
  header();
  console.log(`  ${bold('npx 4ruple')}              check this laptop, start 4ruple and open it
  ${bold('npx 4ruple doctor')}       only run the checks
  ${bold('npx 4ruple deactivate')}   take this laptop off your license, to use the key on another one

  Options: --port 4700   --no-open   --skip-checks
  Data folder: ${HOME}  (set FOURUPLE_HOME to move it)
`);
}

const commands = {
  start,
  doctor: () => { header(); const { ready } = doctor(); console.log(''); process.exit(ready ? 0 : 1); },
  deactivate,
  help,
};

if (has('--version') || has('-v')) console.log(PKG.version);
else if (has('--help') || has('-h') || !commands[command]) help();
else await commands[command]();
