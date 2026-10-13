// Turns an agent CLI's streamed JSON into readable log lines for Logs, and notices the CLI's own
// errors and usage limits. Output of the commands the agent runs is never checked for limits.
import type { AgentCliId } from '@sp-kickstack/shared';

export interface ParsedOutput {
  /** Readable lines for the task log (empty for noise such as hooks or token counts). */
  logs: string[];
  /** The CLI said its usage or rate limit is reached; resetAt when it said until when (ISO). */
  rateLimit?: { resetAt: string | null };
  /** The CLI's own error (not a failing command the agent ran). */
  error?: string;
}

export interface OutputParser {
  push(line: string): ParsedOutput;
  /** Text still buffered when the process ends. */
  flush(): ParsedOutput;
}

const RATE_LIMIT_TEXT = /usage limit|rate[ _-]?limit|quota (?:exceeded|exhausted)|resource[ _]exhausted|too many requests|\b429\b/i;

export function looksLikeRateLimit(text: string): boolean {
  return RATE_LIMIT_TEXT.test(text);
}

/** "…limit reached|1791865200": epoch seconds after a pipe, as Claude Code prints it. */
export function resetFromText(text: string): string | null {
  const match = /\|(\d{10})\b/.exec(text);
  return match ? new Date(Number(match[1]) * 1000).toISOString() : null;
}

const NONE: ParsedOutput = { logs: [] };
const plain = (line: string): ParsedOutput => (line.trim() ? { logs: [line] } : { logs: [] });
const lines = (text: string) => text.split('\n').map((l) => l.trimEnd()).filter((l) => l.trim() !== '');
const cut = (text: string, max = 200) => (text.length > max ? `${text.slice(0, max - 1)}…` : text);

/** One line describing a tool call: its command, file or pattern. */
export function describeTool(name: string, input: Record<string, unknown> | undefined): string {
  const pick = (...keys: string[]) => {
    for (const key of keys) {
      const value = input?.[key];
      if (typeof value === 'string' && value.trim()) return value;
    }
    return null;
  };
  const detail =
    pick('command', 'CommandLine', 'cmd') ??
    pick('file_path', 'TargetFile', 'AbsolutePath', 'path', 'notebook_path') ??
    pick('pattern', 'Query', 'query', 'url', 'Url', 'description') ??
    (input && Object.keys(input).length ? JSON.stringify(input) : '');
  return `→ ${name}${detail ? `: ${cut(detail.replace(/\s+/g, ' ').trim())}` : ''}`;
}

function parseJson(line: string): Record<string, any> | null {
  if (!line.startsWith('{')) return null;
  try {
    const value = JSON.parse(line);
    return value && typeof value === 'object' ? value : null;
  } catch {
    return null;
  }
}

/** The CLI's own failure; a usage-limit wording also marks a rate limit. */
function failure(text: string): ParsedOutput {
  const error = cut(text.trim(), 1000);
  return {
    logs: [`✗ ${error}`],
    error,
    ...(looksLikeRateLimit(text) ? { rateLimit: { resetAt: resetFromText(text) } } : {}),
  };
}

/** Claude Code `-p --output-format stream-json --verbose`. */
export function claudeParser(): OutputParser {
  return {
    push(line) {
      const e = parseJson(line);
      if (!e) return plain(line);
      switch (e.type) {
        case 'system': {
          if (e.subtype !== 'init') return NONE;
          const version = e.claude_code_version ? ` ${e.claude_code_version}` : '';
          return { logs: [`Agent started: Claude Code${version}${e.model ? ` · ${e.model}` : ''}`] };
        }
        case 'rate_limit_event': {
          const info = e.rate_limit_info ?? {};
          if (info.status !== 'rejected') return NONE;
          const resetAt = typeof info.resetsAt === 'number' ? new Date(info.resetsAt * 1000).toISOString() : null;
          return {
            logs: [`Usage limit reached${info.rateLimitType ? ` (${info.rateLimitType})` : ''}${resetAt ? `; resets ${resetAt}` : ''}`],
            rateLimit: { resetAt },
          };
        }
        case 'assistant': {
          const out: string[] = [];
          for (const part of e.message?.content ?? []) {
            if (part?.type === 'text' && typeof part.text === 'string') out.push(...lines(part.text));
            else if (part?.type === 'tool_use') out.push(describeTool(String(part.name ?? 'tool'), part.input));
          }
          return { logs: out };
        }
        case 'user': {
          const out: string[] = [];
          for (const part of e.message?.content ?? []) {
            if (part?.type !== 'tool_result' || !part.is_error) continue;
            const text = typeof part.content === 'string' ? part.content : JSON.stringify(part.content ?? '');
            out.push(`  ✗ ${cut(lines(text)[0] ?? 'failed')}`);
          }
          return { logs: out };
        }
        case 'result': {
          const summary =
            `Finished: ${e.subtype ?? 'done'}` +
            (typeof e.num_turns === 'number' ? ` · ${e.num_turns} turns` : '') +
            (typeof e.duration_ms === 'number' ? ` · ${Math.round(e.duration_ms / 1000)} s` : '') +
            (typeof e.total_cost_usd === 'number' ? ` · $${e.total_cost_usd.toFixed(2)}` : '');
          if (!e.is_error) return { logs: [summary] };
          const text = typeof e.result === 'string' && e.result ? e.result : `Claude Code reported an error (${e.subtype ?? 'unknown'})`;
          const failed = failure(text);
          if (e.api_error_status === 429 && !failed.rateLimit) failed.rateLimit = { resetAt: resetFromText(text) };
          return { ...failed, logs: [summary, ...failed.logs] };
        }
        default:
          return NONE;
      }
    },
    flush: () => NONE,
  };
}

/** AGY `-p <prompt> --output-format stream-json`: text arrives in deltas per step, tools as steps. */
export function agyParser(): OutputParser {
  const text = new Map<number, string>();
  const seenTools = new Set<number>();
  const flushStep = (index: number): string[] => {
    const buffered = text.get(index);
    text.delete(index);
    return buffered ? lines(buffered) : [];
  };
  const flushAll = () => [...text.keys()].flatMap(flushStep);
  return {
    push(line) {
      const e = parseJson(line);
      if (!e) return plain(line);
      if (e.event === 'init') return { logs: [`Agent started: AGY${e.init?.permission_mode ? ` · ${e.init.permission_mode}` : ''}`] };
      if (e.event === 'step_update') {
        const step = e.step_update ?? {};
        const index = Number(step.step_index);
        if (step.step_type === 'agent_response') {
          if (typeof step.text_delta === 'string') text.set(index, (text.get(index) ?? '') + step.text_delta);
          return step.state === 'DONE' ? { logs: flushStep(index) } : NONE;
        }
        if (step.step_type === 'tool' && !seenTools.has(index)) {
          seenTools.add(index);
          return { logs: [describeTool(String(step.tool_name ?? step.tool_info?.name ?? 'tool'), step.tool_info?.parameters)] };
        }
        return NONE;
      }
      if (e.event === 'result') {
        const result = e.result ?? {};
        const pending = flushAll();
        const status = result.status === undefined ? 'SUCCESS' : String(result.status);
        const summary = `Finished: ${status.toLowerCase()}${typeof result.duration_seconds === 'number' ? ` · ${Math.round(result.duration_seconds)} s` : ''}`;
        if (status === 'SUCCESS') return { logs: [...pending, summary] };
        const failed = failure(String(result.error ?? result.message ?? result.response ?? `AGY finished with status ${status}`));
        return { ...failed, logs: [...pending, summary, ...failed.logs] };
      }
      if (e.event === 'error') return failure(String(e.error?.message ?? e.message ?? JSON.stringify(e)));
      return NONE;
    },
    flush: () => ({ logs: flushAll() }),
  };
}

/** Codex `exec --json`: thread, turn and item events. */
export function codexParser(): OutputParser {
  return {
    push(line) {
      const e = parseJson(line);
      if (!e) return plain(line);
      const item = e.item ?? {};
      switch (e.type) {
        case 'thread.started':
          return { logs: ['Agent started: Codex'] };
        case 'item.started':
          return item.type === 'command_execution' ? { logs: [describeTool('shell', { command: item.command })] } : NONE;
        case 'item.completed':
          if (item.type === 'agent_message' && typeof item.text === 'string') return { logs: lines(item.text) };
          if (item.type === 'file_change') return { logs: (item.changes ?? []).map((c: any) => `→ ${c.kind ?? 'edit'}: ${c.path}`) };
          if (item.type === 'command_execution' && typeof item.exit_code === 'number' && item.exit_code !== 0) return { logs: [`  ✗ exit ${item.exit_code}`] };
          if (item.type === 'error' && item.message) return { logs: [`  ✗ ${cut(String(item.message))}`] };
          return NONE;
        case 'turn.completed':
          return { logs: ['Finished'] };
        case 'turn.failed':
          return failure(String(e.error?.message ?? 'Codex turn failed'));
        case 'error':
          return failure(String(e.message ?? e.error?.message ?? 'Codex error'));
        default:
          return NONE;
      }
    },
    flush: () => NONE,
  };
}

export function createParser(cli: AgentCliId): OutputParser {
  if (cli === 'claude-cli') return claudeParser();
  if (cli === 'agy-cli') return agyParser();
  return codexParser();
}
