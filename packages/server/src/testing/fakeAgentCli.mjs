#!/usr/bin/env node
// Test stand-in for an agent CLI. Speaks Claude Code's stream-json (prompt on stdin) or, when
// called as `-p <prompt> …`, AGY's stream-json. Lines "FAKE: <action> <arg>" in the prompt drive it:
//   say <text> · commit <file> · dirty <file> · sleep <ms> · wait-for-note <ms> · wait-once <ms>
//   exit <code> · fail-unless-retry <code> · limit <epoch s> · limit-once <epoch s>
//   stderr <text> · background <ms> · chatty-background · where (says HEAD <sha> and its branch, or (detached))
//   qa-comment <severity>|<file>|<line>|<title> · qa-result passed|failed|<summary> (queued in XTICKET_OUTBOX like xticket's fallback)
// With FAKE_AGENT_LOG_DIR set, each prompt is saved as <XTICKET_TASK>-<n>.md (and argv/env as .json).
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync, spawn } from 'node:child_process';

const argv = process.argv.slice(2);
const agy = argv[0] === '-p' && argv[1] !== undefined && !argv[1].startsWith('--');
const prompt = agy ? argv[1] : fs.readFileSync(0, 'utf8');
const task = process.env.XTICKET_TASK ?? 'unknown';
const logDir = process.env.FAKE_AGENT_LOG_DIR;
if (logDir) {
  fs.mkdirSync(logDir, { recursive: true });
  const n = fs.readdirSync(logDir).filter((f) => f.startsWith(`${task}-`) && f.endsWith('.md')).length + 1;
  fs.writeFileSync(path.join(logDir, `${task}-${n}.md`), prompt);
  const env = {
    XTICKET_URL: process.env.XTICKET_URL, XTICKET_PROJECT: process.env.XTICKET_PROJECT, XTICKET_TASK: task, XTICKET_OUTBOX: process.env.XTICKET_OUTBOX,
    PATH: process.env.PATH, PORT: process.env.PORT, npm_lifecycle_event: process.env.npm_lifecycle_event,
  };
  fs.writeFileSync(path.join(logDir, `${task}-${n}.json`), JSON.stringify({ argv, env, cwd: process.cwd() }));
}

const out = (obj) => process.stdout.write(`${JSON.stringify(obj)}\n`);
let step = 0;
const say = (text) => {
  if (!agy) return out({ type: 'assistant', message: { content: [{ type: 'text', text }] } });
  step += 1;
  out({ event: 'step_update', step_update: { step_index: step, state: 'ACTIVE', step_type: 'agent_response', text_delta: text } });
  out({ event: 'step_update', step_update: { step_index: step, state: 'DONE', step_type: 'agent_response', text_delta: '\n' } });
};
const tool = (command) => {
  if (!agy) return out({ type: 'assistant', message: { content: [{ type: 'tool_use', name: 'Bash', input: { command } }] } });
  step += 1;
  out({ event: 'step_update', step_update: { step_index: step, state: 'ACTIVE', step_type: 'tool', tool_name: 'run_command', tool_info: { name: 'run_command', parameters: { CommandLine: command } } } });
};
const finish = (ok, text) => {
  if (agy) out({ event: 'result', result: { status: ok ? 'SUCCESS' : 'ERROR', response: text, error: ok ? undefined : text, duration_seconds: 1 } });
  else out({ type: 'result', subtype: ok ? 'success' : 'error_during_execution', is_error: !ok, result: text, num_turns: 1, duration_ms: 1000, total_cost_usd: 0 });
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

if (agy) out({ event: 'init', init: { cwd: process.cwd(), permission_mode: 'bypass' } });
else out({ type: 'system', subtype: 'init', claude_code_version: 'fake', model: 'fake-model', permissionMode: 'bypassPermissions' });

const actions = [...prompt.matchAll(/FAKE: ([\w-]+)(?: ([^\n]*))?/g)].map((m) => [m[1], (m[2] ?? '').trim()]);
const continued = prompt.includes('## Continue');
const hasNotes = prompt.includes('## Notes since your last run');
const isRetry = prompt.includes('## Retry');

for (const [action, arg] of actions) {
  if (action === 'say') say(arg);
  else if (action === 'commit' || action === 'dirty') {
    fs.writeFileSync(path.join(process.cwd(), arg), `${arg} ${Date.now()} ${Math.random()}\n`);
    if (action === 'commit') {
      tool(`git add ${arg} && git commit -m "add ${arg}"`);
      execFileSync('git', ['add', '--', arg]);
      execFileSync('git', ['-c', 'user.name=Fake Agent', '-c', 'user.email=agent@example.com', 'commit', '-q', '-m', `add ${arg}`]);
    }
  } else if (action === 'where') {
    const head = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
    const branch = execFileSync('git', ['branch', '--show-current'], { encoding: 'utf8' }).trim();
    say(`HEAD ${head} ${branch ? `on ${branch}` : '(detached)'}`);
  } else if (action === 'qa-comment' || action === 'qa-result') {
    // Queued the way xticket queues when the bridge cannot be reached: tests never post to a live bridge.
    const identity = { project: process.env.XTICKET_PROJECT, engineTaskId: task };
    let payload;
    if (action === 'qa-comment') {
      const [severity, file, line, title] = arg.split('|');
      payload = { kind: 'qa-comment', severity, title, body: '', ...(file ? { file_path: file } : {}), ...(line ? { line: Number(line) } : {}), ...identity };
    } else {
      const [verdict, summary] = arg.split('|');
      payload = { kind: 'qa-result', passed: verdict === 'passed', summary, ...identity };
    }
    tool(`xticket ${action === 'qa-comment' ? 'comment' : 'qa-result'} …`);
    fs.mkdirSync(process.env.XTICKET_OUTBOX, { recursive: true });
    fs.writeFileSync(path.join(process.env.XTICKET_OUTBOX, `${action}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}.json`), JSON.stringify(payload));
  } else if (action === 'sleep') await sleep(Number(arg));
  else if (action === 'wait-for-note') { if (!hasNotes) await sleep(Number(arg)); }
  else if (action === 'wait-once') { if (!continued) await sleep(Number(arg)); }
  else if (action === 'stderr') process.stderr.write(`${arg}\n`);
  else if (action === 'background') {
    const child = spawn('sleep', [String(Math.ceil(Number(arg) / 1000))], { stdio: ['ignore', 'inherit', 'inherit'] });
    if (logDir) fs.writeFileSync(path.join(logDir, `${task}-bg.pid`), String(child.pid));
    child.unref();
  } else if (action === 'chatty-background') {
    // Writes as fast as it can (keeps the pipe full) until its process group is stopped.
    const child = spawn('yes', ['GET /health 200'], { stdio: ['ignore', 'inherit', 'inherit'] });
    if (logDir) fs.writeFileSync(path.join(logDir, `${task}-bg.pid`), String(child.pid));
    child.unref();
  } else if (action === 'exit' || (action === 'fail-unless-retry' && !isRetry)) {
    finish(false, `failed on purpose (${arg})`);
    process.exit(Number(arg));
  } else if (action === 'limit' || (action === 'limit-once' && !continued)) {
    if (!agy) out({ type: 'rate_limit_event', rate_limit_info: { status: 'rejected', resetsAt: Number(arg), rateLimitType: 'five_hour' } });
    finish(false, agy ? 'RESOURCE_EXHAUSTED: quota exceeded' : `Claude AI usage limit reached|${arg}`);
    process.exit(1);
  }
}
finish(true, 'done');
