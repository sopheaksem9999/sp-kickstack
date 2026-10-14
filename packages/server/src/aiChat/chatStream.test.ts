import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { agyParser, claudeParser, type OutputParser } from '../localEngine/outputParsers.js';

const fixture = (name: string) => fs.readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures', name), 'utf8');
const read = (parser: OutputParser, text: string) => {
  const tools: string[] = [];
  let reply: string | undefined;
  for (const line of [...text.split('\n').map((l) => parser.push(l.trim())), parser.flush()]) {
    tools.push(...(line.tools ?? []));
    if (line.reply !== undefined) reply = line.reply;
  }
  return { tools, reply };
};

describe('stream-json: tools used and the reply', () => {
  it('Claude Code: MCP tool names and the result text', () => {
    const { tools, reply } = read(claudeParser(), fixture('claude-mcp-turn.jsonl'));
    expect(tools).toContain('mcp__probe__echo');
    expect(reply?.trim()).toBe('ping');
  });

  it('AGY: tool steps of a recorded turn (AGY refused the MCP call, so there is no answer)', () => {
    const { tools, reply } = read(agyParser(), fixture('agy-mcp-turn.jsonl'));
    expect(tools).toEqual(['view_file', 'call_mcp_tool']);
    expect(reply).toBeUndefined();
  });

  it('AGY: only the text after the last tool step is the reply', () => {
    const j = (o: object) => JSON.stringify(o);
    const text = [
      j({ event: 'step_update', step_update: { step_index: 1, state: 'DONE', step_type: 'agent_response', text_delta: 'Let me look.' } }),
      j({ event: 'step_update', step_update: { step_index: 2, step_type: 'tool', tool_name: 'sp-jira/search', tool_info: { name: 'sp-jira/search', parameters: {} } } }),
      j({ event: 'step_update', step_update: { step_index: 3, state: 'DONE', step_type: 'agent_response', text_delta: 'Found 2 issues.' } }),
      j({ event: 'result', result: { status: 'SUCCESS' } }),
    ].join('\n');
    expect(read(agyParser(), text)).toEqual({ tools: ['sp-jira/search'], reply: 'Found 2 issues.' });
  });
});
