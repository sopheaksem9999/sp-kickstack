#!/usr/bin/env node
// Test stand-in for Claude Code / AGY in AI Chat. Appends { argv, cwd, mcp: { file, content, mode } } to
// $FAKE_CHAT_LOG, then prints a turn: Claude Code stream-json (with --verbose), AGY stream-json, or plain
// text (Claude Code without servers). $FAKE_CHAT_SLEEP_MS delays the answer.
import fs from 'node:fs';

const argv = process.argv.slice(2);
const at = argv.indexOf('--mcp-config');
const file = at >= 0 ? argv[at + 1] : null;
const mcp = file ? { file, content: JSON.parse(fs.readFileSync(file, 'utf8')), mode: (fs.statSync(file).mode & 0o777).toString(8) } : null;
if (process.env.FAKE_CHAT_LOG) fs.appendFileSync(process.env.FAKE_CHAT_LOG, `${JSON.stringify({ argv, cwd: process.cwd(), mcp })}\n`);
const out = (o) => process.stdout.write(`${JSON.stringify(o)}\n`);

setTimeout(() => {
  if (argv.includes('--verbose')) {
    out({ type: 'system', subtype: 'init', model: 'sonnet' });
    out({ type: 'assistant', message: { content: [{ type: 'tool_use', name: 'mcp__jira__search_issues', input: { q: 'a' } }] } });
    out({ type: 'assistant', message: { content: [{ type: 'tool_use', name: 'mcp__jira__search_issues', input: { q: 'b' } }, { type: 'tool_use', name: 'mcp__figma__get_frame', input: {} }] } });
    out({ type: 'result', subtype: 'success', is_error: false, result: 'Found 2 issues.' });
  } else if (argv.includes('stream-json')) {
    out({ event: 'init', init: {} });
    out({ event: 'step_update', step_update: { step_index: 1, state: 'ACTIVE', step_type: 'tool', tool_name: 'call_mcp_tool', tool_info: { name: 'call_mcp_tool', parameters: { ServerName: 'sp-jira', ToolName: 'search_issues', Arguments: {} } } } });
    out({ event: 'step_update', step_update: { step_index: 2, state: 'DONE', step_type: 'agent_response', text_delta: 'Found 2 issues.' } });
    out({ event: 'result', result: { status: 'SUCCESS' } });
  } else {
    process.stdout.write('Plain answer.\n');
  }
}, Number(process.env.FAKE_CHAT_SLEEP_MS || 0));
