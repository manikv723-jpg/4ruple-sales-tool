// Model calls go through the local Claude Code CLI in headless mode,
// so the app uses your existing Claude login and needs no API key.
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';

const CLAUDE_BIN = process.env.CLAUDE_BIN || 'claude';
// Set CLAUDE_USAGE_LOG to a file path to record tokens and cost per call (for pricing the hosted version).
const USAGE_LOG = process.env.CLAUDE_USAGE_LOG;

function logUsage(raw) {
  try {
    const j = JSON.parse(raw);
    fs.appendFileSync(USAGE_LOG, `${JSON.stringify({ at: Date.now(), cost: j.total_cost_usd, turns: j.num_turns, ms: j.duration_ms, usage: j.usage, models: j.modelUsage, subtype: j.subtype, head: String(j.result ?? "").slice(0, 600) })}\n`);
    return typeof j.result === 'string' ? j.result : raw;
  } catch {
    return raw;
  }
}

export function askClaude(prompt, { tools = [], timeoutMs = 5 * 60 * 1000 } = {}) {
  return new Promise((resolve, reject) => {
    const args = ['-p', '--output-format', USAGE_LOG ? 'json' : 'text'];
    if (tools.length) args.push('--allowedTools', tools.join(','));
    const child = spawn(CLAUDE_BIN, args, { cwd: os.tmpdir(), env: process.env });
    let out = '';
    let err = '';
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      reject(new Error(`Claude took longer than ${Math.round(timeoutMs / 1000)}s`));
    }, timeoutMs);
    child.stdout.on('data', (d) => { out += d; });
    child.stderr.on('data', (d) => { err += d; });
    child.on('error', (e) => { clearTimeout(timer); reject(new Error(`Could not start claude CLI: ${e.message}`)); });
    child.on('close', (code) => {
      clearTimeout(timer);
      if (code === 0) resolve(USAGE_LOG ? logUsage(out.trim()) : out.trim());
      else reject(new Error((err || out).trim().slice(0, 400) || `claude exited with ${code}`));
    });
    child.stdin.end(prompt);
  });
}

export function extractJson(text) {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const body = fenced ? fenced[1] : text;
  const start = body.indexOf('{');
  const end = body.lastIndexOf('}');
  if (start < 0 || end <= start) throw new Error('no JSON object found');
  return JSON.parse(body.slice(start, end + 1));
}

export async function askClaudeJson(prompt, opts) {
  const text = await askClaude(prompt, opts);
  try {
    return extractJson(text);
  } catch (e) {
    throw new Error(`Claude reply wasn't valid JSON (${e.message}): ${text.slice(0, 200)}`);
  }
}
