import { describe, it, expect } from 'vitest';
import { agyParser, claudeParser, codexParser, describeTool, looksLikeRateLimit, resetFromText } from './outputParsers.js';

const j = (o: unknown) => JSON.stringify(o);
const iso = (epochSeconds: number) => new Date(epochSeconds * 1000).toISOString();

describe('Claude Code stream-json', () => {
  it('turns events into readable lines and ignores noise', () => {
    const p = claudeParser();
    expect(p.push(j({ type: 'system', subtype: 'hook_started', hook_id: 'x' })).logs).toEqual([]);
    expect(p.push(j({ type: 'system', subtype: 'init', claude_code_version: '2.1.284', model: 'claude-opus-5-5', permissionMode: 'bypassPermissions' })).logs)
      .toEqual(['Agent started: Claude Code 2.1.284 · claude-opus-5-5']);
    expect(p.push(j({ type: 'rate_limit_event', rate_limit_info: { status: 'allowed', resetsAt: 1791865200 } }))).toEqual({ logs: [] });
    expect(p.push(j({ type: 'assistant', message: { content: [{ type: 'thinking' }, { type: 'text', text: 'Plan:\n\n1. tests' }] } })).logs)
      .toEqual(['Plan:', '1. tests']);
    expect(p.push(j({ type: 'assistant', message: { content: [{ type: 'tool_use', name: 'Bash', input: { command: 'npm test' } }] } })).logs)
      .toEqual(['→ Bash: npm test']);
    expect(p.push(j({ type: 'user', message: { content: [{ type: 'tool_result', is_error: true, content: 'Exit code 1\nmore' }] } })).logs)
      .toEqual(['  ✗ Exit code 1']);
    expect(p.push(j({ type: 'result', subtype: 'success', is_error: false, result: 'OK', num_turns: 3, duration_ms: 12400, total_cost_usd: 0.4 })))
      .toEqual({
        logs: ['Finished: success · 3 turns · 12 s · $0.40'],
        usage: { input_tokens: null, output_tokens: null, total_tokens: null, cost_usd: 0.4 },
      });
    expect(p.push('plain text line').logs).toEqual(['plain text line']);
  });

  it('accumulates tokens from assistant messages and extracts usage from result', () => {
    const p = claudeParser();
    p.push(j({ type: 'assistant', message: { usage: { input_tokens: 120, output_tokens: 30 } } }));
    p.push(j({ type: 'assistant', message: { usage: { input_tokens: 80, output_tokens: 20 } } }));
    const out = p.push(j({ type: 'result', subtype: 'success', total_cost_usd: 0.05, usage: { input_tokens: 200, output_tokens: 50 } }));
    expect(out.usage).toEqual({
      input_tokens: 200,
      output_tokens: 50,
      total_tokens: 250,
      cost_usd: 0.05,
    });
  });

  it('reports a rejected usage limit with its reset time', () => {
    const out = claudeParser().push(j({ type: 'rate_limit_event', rate_limit_info: { status: 'rejected', resetsAt: 1791865200, rateLimitType: 'five_hour' } }));
    expect(out.rateLimit).toEqual({ resetAt: iso(1791865200) });
    expect(out.logs[0]).toContain('Usage limit reached (five_hour)');
  });

  it('reports an error result, and a usage-limit error with the reset after the pipe', () => {
    const p = claudeParser();
    const failed = p.push(j({ type: 'result', subtype: 'error_during_execution', is_error: true, result: 'Tool crashed' }));
    expect(failed.error).toBe('Tool crashed');
    expect(failed.rateLimit).toBeUndefined();
    const limited = p.push(j({ type: 'result', subtype: 'success', is_error: true, result: 'Claude AI usage limit reached|1791865200' }));
    expect(limited.rateLimit).toEqual({ resetAt: iso(1791865200) });
    const http429 = p.push(j({ type: 'result', is_error: true, api_error_status: 429, result: 'API Error' }));
    expect(http429.rateLimit).toEqual({ resetAt: null });
  });
});

describe('AGY stream-json', () => {
  it('joins text deltas per step and logs each tool once', () => {
    const p = agyParser();
    expect(p.push(j({ event: 'init', init: { permission_mode: 'bypass' } })).logs).toEqual(['Agent started: AGY · bypass']);
    expect(p.push(j({ event: 'step_update', step_update: { step_index: 1, state: 'ACTIVE', step_type: 'agent_response', text_delta: 'Hel' } })).logs).toEqual([]);
    expect(p.push(j({ event: 'step_update', step_update: { step_index: 1, state: 'DONE', step_type: 'agent_response', text_delta: 'lo\n' } })).logs).toEqual(['Hello']);
    const tool = { step_index: 2, step_type: 'tool', tool_name: 'run_command', tool_info: { name: 'run_command', parameters: { CommandLine: 'git commit -m x' } } };
    expect(p.push(j({ event: 'step_update', step_update: { ...tool, state: 'ACTIVE' } })).logs).toEqual(['→ run_command: git commit -m x']);
    expect(p.push(j({ event: 'step_update', step_update: { ...tool, state: 'DONE' } })).logs).toEqual([]);
    expect(p.push(j({ event: 'result', result: { status: 'SUCCESS', response: 'DONE', duration_seconds: 16.8 } })).logs).toEqual(['Finished: success · 17 s']);
  });

  it('flushes text that never reached DONE', () => {
    const p = agyParser();
    p.push(j({ event: 'step_update', step_update: { step_index: 4, state: 'ACTIVE', step_type: 'agent_response', text_delta: 'half a sentence' } }));
    expect(p.flush().logs).toEqual(['half a sentence']);
  });

  it('reports a failed result and recognises an exhausted quota', () => {
    const out = agyParser().push(j({ event: 'result', result: { status: 'ERROR', error: 'RESOURCE_EXHAUSTED: quota exceeded' } }));
    expect(out.error).toContain('RESOURCE_EXHAUSTED');
    expect(out.rateLimit).toEqual({ resetAt: null });
  });

  it('extracts token usage and cost from AGY result', () => {
    const p = agyParser();
    const out = p.push(j({ event: 'result', result: { status: 'SUCCESS', usage: { input_tokens: 300, output_tokens: 150 }, cost_usd: 0.02 } }));
    expect(out.usage).toEqual({
      input_tokens: 300,
      output_tokens: 150,
      total_tokens: 450,
      cost_usd: 0.02,
    });
  });
});

describe('Codex exec --json', () => {
  it('logs commands, messages and file changes', () => {
    const p = codexParser();
    expect(p.push(j({ type: 'thread.started', thread_id: 't' })).logs).toEqual(['Agent started: Codex']);
    expect(p.push(j({ type: 'item.started', item: { type: 'command_execution', command: 'npm test' } })).logs).toEqual(['→ shell: npm test']);
    expect(p.push(j({ type: 'item.completed', item: { type: 'command_execution', command: 'npm test', exit_code: 1 } })).logs).toEqual(['  ✗ exit 1']);
    expect(p.push(j({ type: 'item.completed', item: { type: 'file_change', changes: [{ path: 'src/a.ts', kind: 'update' }] } })).logs).toEqual(['→ update: src/a.ts']);
    expect(p.push(j({ type: 'item.completed', item: { type: 'agent_message', text: 'All done' } })).logs).toEqual(['All done']);
    expect(p.push(j({ type: 'turn.completed', usage: { input_tokens: 500, output_tokens: 200 } })).usage).toEqual({
      input_tokens: 500,
      output_tokens: 200,
      total_tokens: 700,
      cost_usd: null,
    });
  });

  it('reports a failed turn and a usage limit', () => {
    const out = codexParser().push(j({ type: 'turn.failed', error: { message: "You've hit your usage limit." } }));
    expect(out.error).toContain('usage limit');
    expect(out.rateLimit).toEqual({ resetAt: null });
  });
});

describe('helpers', () => {
  it('recognises usage and rate limits but not ordinary output', () => {
    expect(looksLikeRateLimit('Error: 429 Too Many Requests')).toBe(true);
    expect(looksLikeRateLimit('Claude AI usage limit reached')).toBe(true);
    expect(looksLikeRateLimit('All 42 tests passed')).toBe(false);
    expect(resetFromText('limit reached|1791865200')).toBe(iso(1791865200));
    expect(resetFromText('no time here')).toBeNull();
  });

  it('describes a tool call by its command, file or pattern', () => {
    expect(describeTool('Edit', { file_path: '/w/src/a.ts', old_string: 'x' })).toBe('→ Edit: /w/src/a.ts');
    expect(describeTool('Grep', { pattern: 'TODO' })).toBe('→ Grep: TODO');
    expect(describeTool('TodoWrite', undefined)).toBe('→ TodoWrite');
  });
});
