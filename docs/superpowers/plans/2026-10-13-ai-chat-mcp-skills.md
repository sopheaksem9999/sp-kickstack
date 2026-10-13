# AI Chat MCP Servers and Skills Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Settings → AI Chat lets a person add MCP servers and skills once for the system, and every AI Chat message passes them to Claude Code or AGY.

**Architecture:** A settings key `ai_chat_tools` (servers, skills, time limit) managed by a small `aiChat/` module on the server: an MCP server test (`mcpProbe`), AGY list sync (`agySync`), the settings service with secret masking and imports (`toolsService`), and chat helpers (`chatTools`). `AiChatService` gives Claude Code a per-turn `--mcp-config` (strict, owner-only temp file) and runs AGY in `stream-json`; the output parsers report tool names and the final reply so replies show "Tools used". The web gets a Settings tab and `/skill` commands in the chat.

**Tech Stack:** TypeScript, Express, better-sqlite3, zod 3, execa 9, React 18, TanStack Query, Radix Dialog/Tabs, vitest.

**Spec:** `docs/superpowers/specs/2026-10-13-ai-chat-mcp-skills-design.md`

## Global Constraints

- Node.js **v22.19.0** for every command: `source ~/.nvm/nvm.sh && nvm use 22.19.0`.
- Shared checkout: another session may edit this checkout. Commit exactly the paths a task lists (never `git add -A`); verify on HEAD plus this task's files in an isolated worktree when the working tree holds other uncommitted work.
- New migration is **11** (the latest is 10).
- One list for the whole system (not per workspace). Only what is in Settings for Claude Code (`--strict-mcp-config`).
- Secrets (env values, header values) are never returned to the browser: they come back as `{ "set": true }`; sending `{ "set": true }` keeps the stored value.
- Copy, verbatim from the spec: badges `Connected · N tools`, `Failed: <reason>`, `Not tested`; warning "The AI can use any tool of an enabled server without asking. Only enable servers you are happy for it to use."; timeout "The AI did not answer within N s"; "No SKILL.md found under <folder>"; "Not a .mcp.json file: <reason>"; "AGY not detected".
- Rule A: regenerate the desktop server bundle at the end. Rule B: settings in `schemas.ts` / `types.ts`, saved by `SettingsService`. Rule C: Radix for dialogs. Rule F: the tab is `?tab=ai-chat`.
- The user's dev server loads `@sp-kickstack/shared` from `packages/shared/dist`: after committing shared changes, run `cd packages/shared && npx tsc -p .` in the main checkout and check `curl -s -o /dev/null -w "%{http_code}" localhost:4100/api/health` → `200`.

## Review Focus

1. A server renamed in the same save as `{ "set": true }` secrets: the old secret must not move to the new name; it is dropped (the person types it again). — Task 5 test.
2. The Claude Code MCP config temp file (it holds secrets) is gone after the turn, also when the CLI fails or times out. — Task 8 test.
3. A pasted `.mcp.json` with `type: "sse"` / `"streamable-http"` entries and `${VAR}` placeholders: imported as `http`, placeholder text kept as written. — Task 5 test.
4. AGY sync touches only `sp-` entries: a person's own AGY server with the same base name (`jira`) stays. — Task 4 test.
5. Message text like `/api/users` or `/old-skill` (disabled) is not a skill request; only enabled skills named exactly at a word start are. — Task 8 test.

---

## File Structure

| File | Responsibility |
|---|---|
| `packages/server/src/testing/fakeMcpServer.mjs` (new) | stdio MCP test server (echo/add tools; `--crash`, `--hang`, `--tools=N`, `--require-env=NAME`) |
| `packages/server/src/testing/fakeAgyCli.mjs` (new) | `agy mcp list/add/remove` stand-in with a JSON state file |
| `packages/server/src/testing/fakeChatCli.mjs` (new) | Claude Code / AGY chat stand-in: records argv, cwd and the MCP config, prints a turn |
| `packages/server/src/aiChat/fixtures/*.jsonl` (new) | Recorded real `stream-json` output from Task 1 |
| `packages/server/src/aiChat/cliModes.ts` (new) | Task 1 outcomes: `CLAUDE_CHAT_PERMISSION`, `AGY_CHAT_MCP_MODE` |
| `packages/shared/src/schemas.ts`, `types.ts` | `AiChatToolsSettingsSchema`, update input, view and message types |
| `packages/server/src/services/settingsService.ts` | `getAiChatToolsSettings` / `saveAiChatToolsSettings` |
| `packages/server/src/db/migrations.ts` | Migration 11: `ai_chat_messages.tools_used` |
| `packages/server/src/aiChat/mcpProbe.ts` (new) | Test a server: `initialize` + `tools/list` over stdio or http |
| `packages/server/src/aiChat/agySync.ts` (new) | Read AGY's list; add/remove `sp-<name>` entries |
| `packages/server/src/aiChat/skillImport.ts` (new) | Find and parse `SKILL.md` files |
| `packages/server/src/aiChat/toolsService.ts` (new) | View (masked), save (keep secrets), imports, test, AGY sync |
| `packages/server/src/api/aiChatToolsRoutes.ts` (new) | `/api/ai-chat/tools…` routes |
| `packages/server/src/localEngine/outputParsers.ts` | Report `tools` and `reply` |
| `packages/server/src/aiChat/chatTools.ts` (new) | MCP config file, CLI arguments, skills prompt, `/skill` detection, tool labels |
| `packages/server/src/services/aiChatService.ts` | Use the above in chat turns; save `tools_used`; time limit |
| `packages/web/src/lib/aiChatToolsApi.ts`, `aiChatTools.ts` (new) | API calls and pure helpers |
| `packages/web/src/components/AiChatToolsSettingsSection.tsx` (new) | Settings → AI Chat tab |
| `packages/web/src/components/RichCommentEditor.tsx` | `allowFiles` prop (skill editor has no attachments) |
| `packages/web/src/pages/SettingsPage.tsx` | The tab entry |
| `packages/web/src/pages/AiChatPage.tsx`, `components/BrowserAiSidebar.tsx` | `/skill` commands; "Tools used" line |
| `docs/guide/09-settings-and-environment.md`, `10-troubleshooting.md` | Docs |

---

### Task 1: Check how Claude Code and AGY call MCP tools; test fixtures

**Files:**
- Create: `packages/server/src/testing/fakeMcpServer.mjs`
- Create: `packages/server/src/aiChat/cliModes.ts`
- Create: `packages/server/src/aiChat/fixtures/claude-mcp-turn.jsonl`, `packages/server/src/aiChat/fixtures/agy-mcp-turn.jsonl`

**Interfaces:**
- Produces: `fakeMcpServer.mjs` flags `--crash`, `--hang`, `--tools=N`, `--require-env=NAME`; tools `echo(text)`, `add(a, b)`.
- Produces: `export type ClaudeChatPermission = 'allowed-tools' | 'bypass'; export const CLAUDE_CHAT_PERMISSION: ClaudeChatPermission;` and `export type AgyChatMcpMode = 'native' | 'sandbox' | 'skip-permissions-sandboxed' | 'off'; export const AGY_CHAT_MCP_MODE: AgyChatMcpMode;`
- Produces: fixtures used by Task 7 (`claude-mcp-turn.jsonl` has a `mcp__probe__echo` tool_use and a `result` "ping"; `agy-mcp-turn.jsonl` has a tool step and an `agent_response` "ping").

- [ ] **Step 1: Write the fake MCP server**

```js
#!/usr/bin/env node
// Test stand-in for an MCP server over stdio (JSON-RPC, one message per line).
// Tools: echo(text), add(a, b). Flags: --crash (exit 3 at once), --hang (never answer),
// --tools=N (offer tool1…toolN instead), --require-env=NAME (exit 4 when that variable is missing).
import readline from 'node:readline';

const args = process.argv.slice(2);
const flag = (name) => args.find((a) => a.startsWith(`${name}=`))?.split('=')[1];
if (args.includes('--crash')) process.exit(3);
const needed = flag('--require-env');
if (needed && !process.env[needed]) {
  process.stderr.write(`missing ${needed}\n`);
  process.exit(4);
}
const hang = args.includes('--hang');
const count = Number(flag('--tools') || 0);
const tools = count
  ? Array.from({ length: count }, (_, i) => ({ name: `tool${i + 1}`, description: `Tool ${i + 1}`, inputSchema: { type: 'object', properties: {} } }))
  : [
      { name: 'echo', description: 'Returns the text it gets', inputSchema: { type: 'object', properties: { text: { type: 'string' } }, required: ['text'] } },
      { name: 'add', description: 'Adds two numbers', inputSchema: { type: 'object', properties: { a: { type: 'number' }, b: { type: 'number' } }, required: ['a', 'b'] } },
    ];
const send = (msg) => process.stdout.write(`${JSON.stringify(msg)}\n`);

readline.createInterface({ input: process.stdin }).on('line', (line) => {
  if (hang) return;
  let msg;
  try {
    msg = JSON.parse(line);
  } catch {
    return;
  }
  if (msg.id === undefined) return;
  if (msg.method === 'initialize') {
    return send({ jsonrpc: '2.0', id: msg.id, result: { protocolVersion: msg.params?.protocolVersion ?? '2025-06-18', capabilities: { tools: {} }, serverInfo: { name: 'fake-mcp', version: '1.0.0' } } });
  }
  if (msg.method === 'tools/list') return send({ jsonrpc: '2.0', id: msg.id, result: { tools } });
  if (msg.method === 'tools/call') {
    const { name, arguments: a = {} } = msg.params ?? {};
    const text = name === 'echo' ? String(a.text ?? '') : name === 'add' ? String(Number(a.a) + Number(a.b)) : `called ${name}`;
    return send({ jsonrpc: '2.0', id: msg.id, result: { content: [{ type: 'text', text }] } });
  }
  send({ jsonrpc: '2.0', id: msg.id, error: { code: -32601, message: `Unknown method ${msg.method}` } });
});
```

Make it executable: `chmod +x packages/server/src/testing/fakeMcpServer.mjs`.

- [ ] **Step 2: Smoke-test it**

Run: `printf '%s\n' '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{}}' '{"jsonrpc":"2.0","id":2,"method":"tools/list"}' | node packages/server/src/testing/fakeMcpServer.mjs`
Expected: two JSON lines; the second lists `echo` and `add`.

- [ ] **Step 3: Check Claude Code**

```bash
FAKE=$PWD/packages/server/src/testing/fakeMcpServer.mjs; D=$(mktemp -d)
printf '{"mcpServers":{"probe":{"type":"stdio","command":"node","args":["%s"]}}}' "$FAKE" > $D/mcp.json
(cd $D && claude -p "Call the probe echo tool with text ping, then answer with only the tool's result." \
  --output-format stream-json --verbose --tools "" --mcp-config $D/mcp.json --strict-mcp-config \
  --allowedTools mcp__probe > claude.jsonl); grep -c '"mcp__probe__echo"' $D/claude.jsonl; tail -1 $D/claude.jsonl
```

Expected: a count ≥ 1 and a last line `{"type":"result",…,"result":"ping",…}`.
- If the tool was refused (a `tool_result` mentioning permission), rerun with `--permission-mode bypassPermissions` instead of `--allowedTools mcp__probe` (built-in tools stay off through `--tools ""`). If that works, the decision is `bypass`; otherwise `allowed-tools`.
- Copy the passing output: `cp $D/claude.jsonl packages/server/src/aiChat/fixtures/claude-mcp-turn.jsonl`.

- [ ] **Step 4: Check AGY**

```bash
agy mcp add sp-probe node "$FAKE"; D=$(mktemp -d); cd $D
P="Call the sp-probe echo tool with text ping, then answer with only the tool's result."
agy -p "$P" --output-format stream-json > plain.jsonl
agy -p "$P" --output-format stream-json --sandbox > sandbox.jsonl
agy -p "$P" --output-format stream-json --dangerously-skip-permissions --sandbox > skip.jsonl
agy -p "Run the shell command: touch ~/sp-kickstack-sandbox-probe" --output-format stream-json --dangerously-skip-permissions --sandbox > escape.jsonl
ls ~/sp-kickstack-sandbox-probe; rm -f ~/sp-kickstack-sandbox-probe; agy mcp remove sp-probe; cd -
```

Decide `AGY_CHAT_MCP_MODE` (a run "works" when its output has a tool step for the probe and an `agent_response` with `ping`):
- `plain.jsonl` works → `native`;
- else `sandbox.jsonl` works → `sandbox`;
- else `skip.jsonl` works **and** the `ls` above failed (the sandbox blocked writing to the home folder) → `skip-permissions-sandboxed`;
- else → `off`.
Copy the first working AGY output (or `plain.jsonl` when none works) to `packages/server/src/aiChat/fixtures/agy-mcp-turn.jsonl`. Note the tool name AGY reports (field `tool_name`); Task 8's `toolLabel` must turn it into `probe.echo`.

- [ ] **Step 5: Record the outcomes in code**

```ts
// How the AI Chat lets each CLI call MCP tools, decided by running the real CLIs (plan Task 1, 2026-10-13).

/** Claude Code: allow each server with --allowedTools mcp__<server>, or bypass permissions (built-in tools stay off). */
export type ClaudeChatPermission = 'allowed-tools' | 'bypass';
export const CLAUDE_CHAT_PERMISSION: ClaudeChatPermission = 'allowed-tools';

/**
 * AGY print mode: 'native' calls MCP tools as is; 'sandbox' needs --sandbox; 'skip-permissions-sandboxed'
 * needs --dangerously-skip-permissions with --sandbox; 'off' = AGY chats get no MCP tools (skills only).
 */
export type AgyChatMcpMode = 'native' | 'sandbox' | 'skip-permissions-sandboxed' | 'off';
export const AGY_CHAT_MCP_MODE: AgyChatMcpMode = 'native';
```

Set both constants to the values decided in Steps 3–4.

- [ ] **Step 6: Commit**

```bash
git add packages/server/src/testing/fakeMcpServer.mjs packages/server/src/aiChat/cliModes.ts packages/server/src/aiChat/fixtures
git commit -m "test(server): fake MCP server and recorded MCP turns of Claude Code and AGY"
```

---

### Task 2: Shared settings types, SettingsService and migration 11

**Files:**
- Modify: `packages/shared/src/schemas.ts` (append after `AiCliSettingsSchema`), `packages/shared/src/types.ts` (append; `AiChatMessage` gains `tools_used`)
- Modify: `packages/server/src/services/settingsService.ts`
- Modify: `packages/server/src/db/migrations.ts` (append migration 11), `packages/server/src/db/migrations.test.ts:52`
- Test: `packages/shared/src/aiChatTools.test.ts` (new), `packages/server/src/aiChat/toolsSettings.test.ts` (new)

**Interfaces:**
- Produces (shared): `AI_CHAT_SERVER_NAME: RegExp`, `AI_CHAT_SKILL_NAME: RegExp`, `AI_CHAT_RESERVED_SKILLS: string[]`, `AiChatMcpServerSchema`, `AiChatSkillSchema`, `AiChatToolsSettingsSchema`, `AiChatToolsUpdateInputSchema`, `type AiChatToolsUpdateInput`; types `AiChatServerStatus`, `AiChatMcpServer`, `AiChatSkill`, `AiChatAgySync`, `AiChatToolsSettings`, `AiChatSecret`, `AiChatAgyInfo`, `AiChatToolsView`, `AiChatToolUse`, `AiChatImportResult`; `AiChatMessage.tools_used?: AiChatToolUse[]`.
- Produces (server): `SettingsService.getAiChatToolsSettings(): AiChatToolsSettings`, `SettingsService.saveAiChatToolsSettings(value: AiChatToolsSettings): AiChatToolsSettings`.

- [ ] **Step 1: Write the failing tests**

`packages/shared/src/aiChatTools.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { AiChatToolsSettingsSchema, AiChatToolsUpdateInputSchema } from './schemas';

describe('AI Chat tools settings', () => {
  it('starts empty with a 120 s time limit', () => {
    expect(AiChatToolsSettingsSchema.parse({})).toEqual({ timeLimitSeconds: 120, servers: [], skills: [] });
  });

  it('needs a command for stdio and an http(s) URL for http', () => {
    const ok = (server: object) => AiChatToolsSettingsSchema.safeParse({ servers: [server] }).success;
    expect(ok({ name: 'jira', transport: 'stdio' })).toBe(false);
    expect(ok({ name: 'figma', transport: 'http', url: 'ftp://x' })).toBe(false);
    expect(ok({ name: 'jira', transport: 'stdio', command: 'npx', args: ['-y', 'jira-mcp'] })).toBe(true);
    expect(ok({ name: 'figma', transport: 'http', url: 'https://mcp.figma.com/mcp' })).toBe(true);
  });

  it('checks names: server and skill rules, no duplicates, /create reserved', () => {
    const ok = (value: object) => AiChatToolsSettingsSchema.safeParse(value).success;
    expect(ok({ servers: [{ name: 'my server', transport: 'stdio', command: 'x' }] })).toBe(false);
    expect(ok({ servers: [{ name: 'a', transport: 'stdio', command: 'x' }, { name: 'a', transport: 'stdio', command: 'y' }] })).toBe(false);
    expect(ok({ skills: [{ name: 'API Contract' }] })).toBe(false);
    expect(ok({ skills: [{ name: 'create' }] })).toBe(false);
    expect(ok({ skills: [{ name: 'api-contract', description: 'When writing an API', body: 'Use OpenAPI 3.1' }] })).toBe(true);
  });

  it('takes a kept secret as { set: true } in an update', () => {
    const parsed = AiChatToolsUpdateInputSchema.parse({
      servers: [{ name: 'jira', transport: 'stdio', command: 'x', env: { TOKEN: { set: true }, SITE: 'acme' } }],
    });
    expect(parsed.servers[0].env).toEqual({ TOKEN: { set: true }, SITE: 'acme' });
  });
});
```

`packages/server/src/aiChat/toolsSettings.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { initDatabase } from '../db/index.js';
import { SettingsService } from '../services/settingsService.js';

describe('AI Chat tools in settings', () => {
  it('starts empty and stores what is saved', () => {
    const settings = new SettingsService(initDatabase(':memory:'));
    expect(settings.getAiChatToolsSettings()).toEqual({ timeLimitSeconds: 120, servers: [], skills: [] });
    settings.saveAiChatToolsSettings({
      timeLimitSeconds: 60,
      servers: [{ name: 'jira', enabled: true, transport: 'stdio', command: 'npx', args: [], env: { TOKEN: 'x' }, headers: {} }],
      skills: [],
    });
    expect(settings.getAiChatToolsSettings()).toMatchObject({ timeLimitSeconds: 60, servers: [{ name: 'jira', env: { TOKEN: 'x' } }] });
  });

  it('migration 11 gives chat messages a tools_used column', () => {
    const db = initDatabase(':memory:');
    const columns = (db.pragma('table_info(ai_chat_messages)') as Array<{ name: string }>).map((c) => c.name);
    expect(columns).toContain('tools_used');
  });
});
```

- [ ] **Step 2: Run them to see them fail**

Run: `npx vitest run packages/shared/src/aiChatTools.test.ts packages/server/src/aiChat/toolsSettings.test.ts`
Expected: FAIL (`AiChatToolsSettingsSchema` is not exported; `getAiChatToolsSettings` is not a function).

- [ ] **Step 3: Add the shared schemas** (append to `packages/shared/src/schemas.ts`, after `AiCliSettingsSchema`)

```ts
/** AI Chat: MCP servers and skills for the chats, one list for the whole system. */
export const AI_CHAT_SERVER_NAME = /^[A-Za-z0-9_-]{1,40}$/;
export const AI_CHAT_SKILL_NAME = /^[a-z0-9][a-z0-9-]{0,39}$/;
/** Chat commands a skill cannot be named after. */
export const AI_CHAT_RESERVED_SKILLS = ['create'];

const AiChatSecretSchema = z.union([z.string(), z.object({ set: z.literal(true) })]);

const AiChatServerStatusSchema = z.object({
  ok: z.boolean(),
  tools: z.number().int().min(0),
  error: z.string().optional(),
  checkedAt: z.string(),
});

const AiChatMcpServerBase = z.object({
  name: z.string().regex(AI_CHAT_SERVER_NAME, 'Server names use letters, digits, - and _ (up to 40)'),
  enabled: z.boolean().default(true),
  transport: z.enum(['stdio', 'http']),
  command: z.string().trim().min(1).optional(),
  args: z.array(z.string()).default([]),
  url: z.string().trim().optional(),
});

function checkServer(server: { transport: 'stdio' | 'http'; command?: string; url?: string }, ctx: z.RefinementCtx) {
  if (server.transport === 'stdio' && !server.command) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['command'], message: 'A stdio server needs a command' });
  }
  if (server.transport === 'http' && !/^https?:\/\/\S+$/.test(server.url ?? '')) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['url'], message: 'An http server needs a URL starting with http:// or https://' });
  }
}

export const AiChatMcpServerSchema = AiChatMcpServerBase.extend({
  env: z.record(z.string()).default({}),
  headers: z.record(z.string()).default({}),
  status: AiChatServerStatusSchema.optional(),
}).superRefine(checkServer);

const AiChatMcpServerUpdateSchema = AiChatMcpServerBase.extend({
  env: z.record(AiChatSecretSchema).default({}),
  headers: z.record(AiChatSecretSchema).default({}),
}).superRefine(checkServer);

export const AiChatSkillSchema = z.object({
  name: z
    .string()
    .regex(AI_CHAT_SKILL_NAME, 'Skill names use lowercase letters, digits and - (up to 40)')
    .refine((name) => !AI_CHAT_RESERVED_SKILLS.includes(name), '/create is a chat command; choose another name'),
  description: z.string().trim().max(300).default(''),
  body: z.string().max(100_000).default(''),
  mode: z.enum(['always', 'on_request']).default('on_request'),
  enabled: z.boolean().default(true),
  sourcePath: z.string().optional(),
});

const AiChatAgySyncSchema = z.object({ ok: z.boolean(), message: z.string(), at: z.string() });

function uniqueNames(value: { servers: Array<{ name: string }>; skills: Array<{ name: string }> }, ctx: z.RefinementCtx) {
  const twice = (names: string[]) => names.find((name, i) => names.indexOf(name) !== i);
  const server = twice(value.servers.map((s) => s.name));
  if (server) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['servers'], message: `Two servers are named ${server}` });
  const skill = twice(value.skills.map((s) => s.name));
  if (skill) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['skills'], message: `Two skills are named ${skill}` });
}

const timeLimitSeconds = z.number().int().min(5).max(1800).default(120);

export const AiChatToolsSettingsSchema = z
  .object({
    timeLimitSeconds,
    servers: z.array(AiChatMcpServerSchema).default([]),
    skills: z.array(AiChatSkillSchema).default([]),
    agySync: AiChatAgySyncSchema.optional(),
  })
  .superRefine(uniqueNames);

/** What the browser saves: secrets are new text, or { set: true } to keep the stored value. */
export const AiChatToolsUpdateInputSchema = z
  .object({
    timeLimitSeconds,
    servers: z.array(AiChatMcpServerUpdateSchema).default([]),
    skills: z.array(AiChatSkillSchema).default([]),
  })
  .superRefine(uniqueNames);

export type AiChatToolsUpdateInput = z.input<typeof AiChatToolsUpdateInputSchema>;
```

- [ ] **Step 4: Add the shared types** (append to `packages/shared/src/types.ts`; and add `tools_used?: AiChatToolUse[];` as the last field of `interface AiChatMessage`)

```ts
export interface AiChatServerStatus {
  ok: boolean;
  tools: number;
  error?: string;
  checkedAt: string;
}

export interface AiChatMcpServer {
  name: string;
  enabled: boolean;
  transport: 'stdio' | 'http';
  command?: string;
  args: string[];
  /** Secret values. */
  env: Record<string, string>;
  url?: string;
  /** Secret values. */
  headers: Record<string, string>;
  status?: AiChatServerStatus;
}

export interface AiChatSkill {
  name: string;
  /** When to use. */
  description: string;
  body: string;
  mode: 'always' | 'on_request';
  enabled: boolean;
  sourcePath?: string;
}

export interface AiChatAgySync {
  ok: boolean;
  message: string;
  at: string;
}

export interface AiChatToolsSettings {
  timeLimitSeconds: number;
  servers: AiChatMcpServer[];
  skills: AiChatSkill[];
  agySync?: AiChatAgySync;
}

/** A secret value as the browser sees it: never the text once stored. */
export type AiChatSecret = string | { set: true };

export interface AiChatAgyInfo {
  detected: boolean;
  /** AGY chats call MCP tools on this PC (see cliModes.ts). */
  usesMcp: boolean;
  servers: Array<{ name: string; type: string; status: string; target: string }>;
  error?: string;
}

export interface AiChatToolsView extends Omit<AiChatToolsSettings, 'servers'> {
  servers: Array<Omit<AiChatMcpServer, 'env' | 'headers'> & { env: Record<string, AiChatSecret>; headers: Record<string, AiChatSecret> }>;
  agy: AiChatAgyInfo;
}

export interface AiChatToolUse {
  tool: string;
  count: number;
}

export interface AiChatImportResult {
  added: string[];
  skipped: Array<{ name: string; reason: string }>;
}
```

- [ ] **Step 5: SettingsService** (`packages/server/src/services/settingsService.ts`: add `AiChatToolsSettings, AiChatToolsSettingsSchema` to the shared import, then these methods after `updateAiCliSettings`)

```ts
  /** Settings → AI Chat: MCP servers, skills and the chat time limit. */
  public getAiChatToolsSettings(): AiChatToolsSettings {
    const row = this.db.prepare("SELECT value FROM settings WHERE key = 'ai_chat_tools'").get() as { value?: string } | undefined;
    if (row?.value) {
      try {
        return AiChatToolsSettingsSchema.parse(JSON.parse(row.value));
      } catch {
        // Fall back to the defaults below.
      }
    }
    return AiChatToolsSettingsSchema.parse({});
  }

  public saveAiChatToolsSettings(value: AiChatToolsSettings): AiChatToolsSettings {
    const parsed = AiChatToolsSettingsSchema.parse(value);
    this.db
      .prepare("INSERT INTO settings (key, value) VALUES ('ai_chat_tools', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value")
      .run(JSON.stringify(parsed));
    return parsed;
  }
```

- [ ] **Step 6: Migration 11** (append to the `MIGRATIONS` array in `packages/server/src/db/migrations.ts`) and change `packages/server/src/db/migrations.test.ts:52` to `expect(LATEST_VERSION).toBe(11);`

```ts
  {
    version: 11,
    name: 'AI chat replies remember the tools they used',
    up: (db) => {
      addColumn(db, 'ai_chat_messages', 'tools_used', 'TEXT');
    },
  },
```

- [ ] **Step 7: Run the tests**

Run: `(cd packages/shared && npx tsc -p .) && npx vitest run packages/shared/src/aiChatTools.test.ts packages/server/src/aiChat/toolsSettings.test.ts packages/server/src/db`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add packages/shared/src/schemas.ts packages/shared/src/types.ts packages/shared/src/aiChatTools.test.ts packages/server/src/services/settingsService.ts packages/server/src/db/migrations.ts packages/server/src/db/migrations.test.ts packages/server/src/aiChat/toolsSettings.test.ts
git commit -m "feat: AI Chat tools settings (servers, skills, time limit) and migration 11"
```

---

### Task 3: Test an MCP server

**Files:**
- Create: `packages/server/src/aiChat/mcpProbe.ts`
- Test: `packages/server/src/aiChat/mcpProbe.test.ts`

**Interfaces:**
- Consumes: `fakeMcpServer.mjs` (Task 1).
- Produces: `export type ProbeResult = { ok: true; tools: number } | { ok: false; error: string };` and `export function probeMcpServer(server: Pick<AiChatMcpServer, 'transport' | 'command' | 'args' | 'env' | 'url' | 'headers'>, timeoutMs?: number): Promise<ProbeResult>` (default 15 000 ms).

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect, afterEach } from 'vitest';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { AddressInfo } from 'node:net';
import { probeMcpServer } from './mcpProbe.js';

const FAKE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../testing/fakeMcpServer.mjs');
const stdio = (args: string[], env: Record<string, string> = {}) => ({ transport: 'stdio' as const, command: process.execPath, args: [FAKE, ...args], env, headers: {} });

let server: http.Server | null = null;
afterEach(() => server?.close());

/** An http MCP server answering JSON or event-stream; checks the session header after initialize. */
async function httpServer(kind: 'json' | 'sse' | '401'): Promise<string> {
  server = http.createServer((req, res) => {
    let body = '';
    req.on('data', (d) => (body += d));
    req.on('end', () => {
      if (kind === '401') return res.writeHead(401).end();
      const msg = JSON.parse(body);
      if (msg.id === undefined) return res.writeHead(202).end();
      if (msg.method !== 'initialize' && req.headers['mcp-session-id'] !== 's-1') return res.writeHead(400).end();
      const answer = msg.method === 'initialize'
        ? { jsonrpc: '2.0', id: msg.id, result: { protocolVersion: '2025-06-18', capabilities: {}, serverInfo: { name: 'h', version: '1' } } }
        : { jsonrpc: '2.0', id: msg.id, result: { tools: [{ name: 'a' }, { name: 'b' }, { name: 'c' }] } };
      if (kind === 'sse') {
        res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Mcp-Session-Id': 's-1' }).end(`event: message\ndata: ${JSON.stringify(answer)}\n\n`);
      } else {
        res.writeHead(200, { 'Content-Type': 'application/json', 'Mcp-Session-Id': 's-1' }).end(JSON.stringify(answer));
      }
    });
  });
  await new Promise<void>((ready) => server!.listen(0, '127.0.0.1', ready));
  return `http://127.0.0.1:${(server!.address() as AddressInfo).port}/mcp`;
}

describe('MCP server test', () => {
  it('counts the tools of a stdio server', async () => {
    expect(await probeMcpServer(stdio([]))).toEqual({ ok: true, tools: 2 });
    expect(await probeMcpServer(stdio(['--tools=5']))).toEqual({ ok: true, tools: 5 });
  });

  it("passes the server's environment variables", async () => {
    expect(await probeMcpServer(stdio(['--require-env=JIRA_TOKEN'], { JIRA_TOKEN: 'x' }))).toEqual({ ok: true, tools: 2 });
    expect(await probeMcpServer(stdio(['--require-env=JIRA_TOKEN']))).toEqual({ ok: false, error: 'exited with code 4: missing JIRA_TOKEN' });
  });

  it('reports a crash, a missing command and a server that never answers', async () => {
    expect(await probeMcpServer(stdio(['--crash']))).toEqual({ ok: false, error: 'exited with code 3' });
    const missing = await probeMcpServer({ transport: 'stdio', command: 'sp-no-such-command', args: [], env: {}, headers: {} });
    expect(missing.ok).toBe(false);
    expect(!missing.ok && missing.error).toContain('ENOENT');
    expect(await probeMcpServer(stdio(['--hang']), 1000)).toEqual({ ok: false, error: 'no answer within 1 s' });
  });

  it('talks to an http server answering JSON or an event stream', async () => {
    expect(await probeMcpServer({ transport: 'http', url: await httpServer('json'), args: [], env: {}, headers: {} })).toEqual({ ok: true, tools: 3 });
    server!.close();
    expect(await probeMcpServer({ transport: 'http', url: await httpServer('sse'), args: [], env: {}, headers: {} })).toEqual({ ok: true, tools: 3 });
    server!.close();
    expect(await probeMcpServer({ transport: 'http', url: await httpServer('401'), args: [], env: {}, headers: {} })).toEqual({
      ok: false,
      error: 'HTTP 401 (check the headers / token)',
    });
  });
});
```

- [ ] **Step 2: Run it to see it fail**

Run: `npx vitest run packages/server/src/aiChat/mcpProbe.test.ts`
Expected: FAIL ("Failed to load url ./mcpProbe.js").

- [ ] **Step 3: Write the implementation**

```ts
// Settings → AI Chat → Test: connect like an MCP client (initialize, then tools/list) and count the tools.
import { spawn } from 'node:child_process';
import type { AiChatMcpServer } from '@sp-kickstack/shared';
import { oneLine } from '../lib/promptSafety.js';

export type ProbeResult = { ok: true; tools: number } | { ok: false; error: string };
type Target = Pick<AiChatMcpServer, 'transport' | 'command' | 'args' | 'env' | 'url' | 'headers'>;

const initialize = (id: number) => ({
  jsonrpc: '2.0',
  id,
  method: 'initialize',
  params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'sp-kickstack', version: '1' } },
});
const listTools = (id: number) => ({ jsonrpc: '2.0', id, method: 'tools/list', params: {} });
const initialized = { jsonrpc: '2.0', method: 'notifications/initialized' };
const seconds = (ms: number) => `no answer within ${Math.round(ms / 1000)} s`;

export async function probeMcpServer(server: Target, timeoutMs = 15_000): Promise<ProbeResult> {
  try {
    const tools = server.transport === 'http' ? await probeHttp(server, timeoutMs) : await probeStdio(server, timeoutMs);
    return { ok: true, tools };
  } catch (err: any) {
    return { ok: false, error: oneLine(err?.message || String(err), 300) };
  }
}

function probeStdio(server: Target, timeoutMs: number): Promise<number> {
  return new Promise((resolve, reject) => {
    const child = spawn(server.command ?? '', server.args ?? [], { env: { ...process.env, ...server.env }, stdio: ['pipe', 'pipe', 'pipe'] });
    let stderr = '';
    let buffer = '';
    let done = false;
    const finish = (settle: () => void) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      child.kill('SIGKILL');
      settle();
    };
    const timer = setTimeout(() => finish(() => reject(new Error(seconds(timeoutMs)))), timeoutMs);
    const send = (msg: object) => child.stdin.write(`${JSON.stringify(msg)}\n`);
    child.on('error', (err) => finish(() => reject(err)));
    child.on('exit', (code) => {
      const last = stderr.trim().split('\n').pop();
      finish(() => reject(new Error(`exited with code ${code}${last ? `: ${last}` : ''}`)));
    });
    child.stderr.on('data', (d) => (stderr += d));
    child.stdin.on('error', () => undefined);
    child.stdout.on('data', (chunk) => {
      buffer += chunk;
      for (let nl = buffer.indexOf('\n'); nl >= 0; nl = buffer.indexOf('\n')) {
        const line = buffer.slice(0, nl).trim();
        buffer = buffer.slice(nl + 1);
        let msg: any;
        try {
          msg = JSON.parse(line);
        } catch {
          continue;
        }
        if (msg.id === 1) {
          if (msg.error) return finish(() => reject(new Error(msg.error.message ?? 'initialize failed')));
          send(initialized);
          send(listTools(2));
        } else if (msg.id === 2) {
          if (msg.error) return finish(() => reject(new Error(msg.error.message ?? 'tools/list failed')));
          return finish(() => resolve(Array.isArray(msg.result?.tools) ? msg.result.tools.length : 0));
        }
      }
    });
    send(initialize(1));
  });
}

async function probeHttp(server: Target, timeoutMs: number): Promise<number> {
  const signal = AbortSignal.timeout(timeoutMs);
  let session: string | null = null;
  const post = async (body: object): Promise<any> => {
    const res = await fetch(server.url ?? '', {
      method: 'POST',
      signal,
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json, text/event-stream',
        ...(session ? { 'Mcp-Session-Id': session } : {}),
        ...server.headers,
      },
      body: JSON.stringify(body),
    });
    session = res.headers.get('mcp-session-id') ?? session;
    if (!res.ok) throw new Error(`HTTP ${res.status}${res.status === 401 || res.status === 403 ? ' (check the headers / token)' : ''}`);
    const text = await res.text();
    if (!text.trim()) return null;
    const messages = (res.headers.get('content-type') ?? '').includes('text/event-stream')
      ? text.split('\n').filter((l) => l.startsWith('data:')).map((l) => JSON.parse(l.slice(5)))
      : [JSON.parse(text)];
    return messages.find((m) => m && 'id' in m && (m.result || m.error)) ?? null;
  };
  try {
    const init = await post(initialize(1));
    if (!init || init.error) throw new Error(init?.error?.message ?? 'no answer to initialize');
    await post(initialized);
    const list = await post(listTools(2));
    if (!list || list.error) throw new Error(list?.error?.message ?? 'no answer to tools/list');
    return Array.isArray(list.result?.tools) ? list.result.tools.length : 0;
  } catch (err: any) {
    if (err?.name === 'TimeoutError') throw new Error(seconds(timeoutMs));
    throw err;
  }
}
```

- [ ] **Step 4: Run the test**

Run: `npx vitest run packages/server/src/aiChat/mcpProbe.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/server/src/aiChat/mcpProbe.ts packages/server/src/aiChat/mcpProbe.test.ts
git commit -m "feat(server): test an MCP server (stdio or http) and count its tools"
```

---

### Task 4: AGY's MCP list and the `sp-` sync

**Files:**
- Create: `packages/server/src/testing/fakeAgyCli.mjs`
- Create: `packages/server/src/aiChat/agySync.ts`
- Test: `packages/server/src/aiChat/agySync.test.ts`

**Interfaces:**
- Consumes: `AiChatMcpServer`, `AiChatAgyInfo`, `AiChatAgySync` (Task 2).
- Produces: `runAgy(bin: string, args: string[], timeoutMs?: number): Promise<string>`; `parseAgyList(text: string): AiChatAgyInfo['servers']`; `agyInfo(bin: string | null, usesMcp: boolean): Promise<AiChatAgyInfo>`; `agyAddArgs(server: AiChatMcpServer): string[]`; `syncAgy(bin: string | null, servers: AiChatMcpServer[], usesMcp: boolean, now?: () => string): Promise<AiChatAgySync>`.

- [ ] **Step 1: Write the fake `agy`** (`chmod +x` afterwards)

```js
#!/usr/bin/env node
// Test stand-in for `agy mcp list|add|remove`. The list lives in $FAKE_AGY_STATE (JSON); each call is
// appended to $FAKE_AGY_LOG. $FAKE_AGY_FAIL makes every call fail with that message.
import fs from 'node:fs';

const [cmd, sub, ...rest] = process.argv.slice(2);
const statePath = process.env.FAKE_AGY_STATE;
const state = statePath && fs.existsSync(statePath) ? JSON.parse(fs.readFileSync(statePath, 'utf8')) : [];
if (process.env.FAKE_AGY_LOG) fs.appendFileSync(process.env.FAKE_AGY_LOG, `${JSON.stringify(process.argv.slice(2))}\n`);
if (process.env.FAKE_AGY_FAIL) {
  process.stderr.write(`${process.env.FAKE_AGY_FAIL}\n`);
  process.exit(1);
}
const save = (list) => fs.writeFileSync(statePath, JSON.stringify(list));
if (cmd !== 'mcp') process.exit(2);
if (sub === 'list') {
  console.log('NAME                        TYPE   STATUS   COMMAND/URL');
  for (const s of state) console.log(`${s.name.padEnd(28)}${s.type.padEnd(7)}enabled  ${s.target}`);
} else if (sub === 'add') {
  let i = 0;
  while (rest[i]?.startsWith('--') && rest[i] !== '--') i += 2;
  const name = rest[i];
  const after = rest.slice(i + 1).filter((a) => a !== '--');
  save(state.filter((s) => s.name !== name).concat([{ name, type: /^https?:/.test(after[0] ?? '') ? 'http' : 'stdio', target: after.join(' ') }]));
} else if (sub === 'remove') {
  save(state.filter((s) => s.name !== rest[0]));
} else {
  process.exit(2);
}
```

- [ ] **Step 2: Write the failing test**

```ts
import { describe, it, expect, beforeEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { AiChatMcpServer } from '@sp-kickstack/shared';
import { agyInfo, parseAgyList, syncAgy } from './agySync.js';

const FAKE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../testing/fakeAgyCli.mjs');
let dir: string;
const state = () => JSON.parse(fs.readFileSync(path.join(dir, 'state.json'), 'utf8')) as Array<{ name: string; target: string }>;
const calls = () => fs.readFileSync(path.join(dir, 'log'), 'utf8').trim().split('\n').map((l) => JSON.parse(l));
const server = (name: string, over: Partial<AiChatMcpServer> = {}): AiChatMcpServer => ({
  name, enabled: true, transport: 'stdio', command: 'npx', args: ['-y', `${name}-mcp`], env: {}, headers: {}, ...over,
});

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sp-agy-'));
  process.env.FAKE_AGY_STATE = path.join(dir, 'state.json');
  process.env.FAKE_AGY_LOG = path.join(dir, 'log');
  delete process.env.FAKE_AGY_FAIL;
  fs.writeFileSync(process.env.FAKE_AGY_STATE, JSON.stringify([
    { name: 'jira', type: 'stdio', target: 'my-own-jira' },
    { name: 'sp-old', type: 'stdio', target: 'gone' },
  ]));
});

describe("AGY's MCP list", () => {
  it('reads the list AGY prints', async () => {
    expect(parseAgyList('NAME   TYPE   STATUS   COMMAND/URL\ngoogle-developer-knowledge  http   enabled  https://x/mcp\n')).toEqual([
      { name: 'google-developer-knowledge', type: 'http', status: 'enabled', target: 'https://x/mcp' },
    ]);
    expect(await agyInfo(FAKE, true)).toMatchObject({ detected: true, usesMcp: true, servers: [{ name: 'jira' }, { name: 'sp-old' }] });
    expect(await agyInfo(null, true)).toEqual({ detected: false, usesMcp: true, servers: [] });
  });

  it('adds enabled servers as sp-<name>, removes stale sp- entries and never touches the rest', async () => {
    const result = await syncAgy(FAKE, [
      server('jira', { env: { TOKEN: 't-1' } }),
      server('figma', { transport: 'http', command: undefined, args: [], url: 'https://mcp.figma.com/mcp', headers: { Authorization: 'Bearer x' } }),
      server('sentry', { enabled: false }),
    ], true, () => 'T');
    expect(result).toEqual({ ok: true, message: "AGY's list updated: 2 added or updated, 1 removed", at: 'T' });
    expect(state().map((s) => s.name)).toEqual(['jira', 'sp-jira', 'sp-figma']);
    expect(state()[0].target).toBe('my-own-jira');
    expect(calls()).toEqual(expect.arrayContaining([
      ['mcp', 'add', '--env', 'TOKEN=t-1', 'sp-jira', '--', 'npx', '-y', 'jira-mcp'],
      ['mcp', 'add', '--header', 'Authorization: Bearer x', 'sp-figma', 'https://mcp.figma.com/mcp'],
      ['mcp', 'remove', 'sp-old'],
    ]));
  });

  it('removes every sp- entry when AGY chats do not use MCP tools', async () => {
    const result = await syncAgy(FAKE, [server('jira')], false, () => 'T');
    expect(result.message).toBe('AGY chats do not use MCP tools on this PC; removed 1 sp- entry from its list');
    expect(state().map((s) => s.name)).toEqual(['jira']);
  });

  it('reports AGY missing or failing', async () => {
    expect(await syncAgy(null, [server('jira')], true, () => 'T')).toEqual({ ok: false, message: 'AGY not detected', at: 'T' });
    process.env.FAKE_AGY_FAIL = 'boom';
    expect(await syncAgy(FAKE, [server('jira')], true, () => 'T')).toEqual({ ok: false, message: "Could not update AGY's list: boom", at: 'T' });
  });
});
```

- [ ] **Step 3: Run it to see it fail**

Run: `npx vitest run packages/server/src/aiChat/agySync.test.ts`
Expected: FAIL ("Failed to load url ./agySync.js").

- [ ] **Step 4: Write the implementation**

```ts
// AGY keeps one global MCP list (`agy mcp …`). The AI Chat adds its enabled servers there as
// `sp-<name>` and removes stale `sp-` entries; other entries are never touched.
import { execFile } from 'node:child_process';
import type { AiChatAgyInfo, AiChatAgySync, AiChatMcpServer } from '@sp-kickstack/shared';
import { oneLine } from '../lib/promptSafety.js';

const PREFIX = 'sp-';

export function runAgy(bin: string, args: string[], timeoutMs = 15_000): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(bin, args, { timeout: timeoutMs, encoding: 'utf8' }, (err, stdout, stderr) => {
      if (err) return reject(new Error((stderr || err.message).trim()));
      resolve(stdout);
    });
  });
}

/** `agy mcp list` rows: NAME, TYPE, STATUS, COMMAND/URL separated by two or more spaces. */
export function parseAgyList(text: string): AiChatAgyInfo['servers'] {
  return text
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith('NAME'))
    .map((line) => {
      const [name, type = '', status = '', ...target] = line.split(/\s{2,}/);
      return { name, type, status, target: target.join('  ') };
    });
}

export async function agyInfo(bin: string | null, usesMcp: boolean): Promise<AiChatAgyInfo> {
  if (!bin) return { detected: false, usesMcp, servers: [] };
  try {
    return { detected: true, usesMcp, servers: parseAgyList(await runAgy(bin, ['mcp', 'list'])) };
  } catch (err: any) {
    return { detected: true, usesMcp, servers: [], error: oneLine(err?.message || String(err), 300) };
  }
}

export function agyAddArgs(server: AiChatMcpServer): string[] {
  const flags = [
    ...Object.entries(server.env).flatMap(([key, value]) => ['--env', `${key}=${value}`]),
    ...Object.entries(server.headers).flatMap(([key, value]) => ['--header', `${key}: ${value}`]),
  ];
  const name = `${PREFIX}${server.name}`;
  return server.transport === 'http'
    ? ['mcp', 'add', ...flags, name, server.url ?? '']
    : ['mcp', 'add', ...flags, name, '--', server.command ?? '', ...server.args];
}

export async function syncAgy(
  bin: string | null,
  servers: AiChatMcpServer[],
  usesMcp: boolean,
  now: () => string = () => new Date().toISOString()
): Promise<AiChatAgySync> {
  if (!bin) return { ok: false, message: 'AGY not detected', at: now() };
  try {
    const ours = parseAgyList(await runAgy(bin, ['mcp', 'list'])).map((s) => s.name).filter((name) => name.startsWith(PREFIX));
    const wanted = usesMcp ? servers.filter((s) => s.enabled) : [];
    for (const server of wanted) await runAgy(bin, agyAddArgs(server));
    const keep = new Set(wanted.map((s) => `${PREFIX}${s.name}`));
    const stale = ours.filter((name) => !keep.has(name));
    for (const name of stale) await runAgy(bin, ['mcp', 'remove', name]);
    const message = usesMcp
      ? `AGY's list updated: ${wanted.length} added or updated, ${stale.length} removed`
      : `AGY chats do not use MCP tools on this PC; removed ${stale.length} sp- ${stale.length === 1 ? 'entry' : 'entries'} from its list`;
    return { ok: true, message, at: now() };
  } catch (err: any) {
    return { ok: false, message: `Could not update AGY's list: ${oneLine(err?.message || String(err), 300)}`, at: now() };
  }
}
```

- [ ] **Step 5: Run the test**

Run: `npx vitest run packages/server/src/aiChat/agySync.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 6: Commit**

```bash
git add packages/server/src/testing/fakeAgyCli.mjs packages/server/src/aiChat/agySync.ts packages/server/src/aiChat/agySync.test.ts
git commit -m "feat(server): read AGY's MCP list and keep its sp- entries in step"
```

---

### Task 5: The AI Chat tools service (view, save, imports, test, AGY)

**Files:**
- Create: `packages/server/src/aiChat/skillImport.ts`, `packages/server/src/aiChat/toolsService.ts`
- Test: `packages/server/src/aiChat/skillImport.test.ts`, `packages/server/src/aiChat/toolsService.test.ts`

**Interfaces:**
- Consumes: `SettingsService.getAiChatToolsSettings/saveAiChatToolsSettings`, `AiChatToolsUpdateInputSchema`, `AiChatMcpServerSchema`, `AiChatSkillSchema` (Task 2); `probeMcpServer` (Task 3); `agyInfo`, `syncAgy` (Task 4); `AGY_CHAT_MCP_MODE` (Task 1); `cliBinary` (`localEngine/cliProfiles.ts`).
- Produces: `parseSkillFile(text: string, folderName: string, sourcePath: string): { name: string; description: string; body: string; sourcePath: string }`, `skillSlug(raw: string): string`, `findSkillFiles(folder: string): string[]`, `expandHome(p: string): string`.
- Produces: `class AiChatToolsService` with `constructor(settings: SettingsService, options?: AiChatToolsOptions)`, `current(): AiChatToolsSettings`, `view(): Promise<AiChatToolsView>`, `save(input: AiChatToolsUpdateInput): AiChatToolsSettings`, `importMcpJson(text: string): AiChatImportResult`, `importSkills(folder: string): AiChatImportResult`, `reimportSkill(name: string): AiChatSkill`, `testServer(name: string): Promise<AiChatServerStatus>`, `syncAgy(): Promise<AiChatAgySync>`; `interface AiChatToolsOptions { probe?; agyInfo?; syncAgy?; now? }`.

- [ ] **Step 1: Write the failing tests**

`packages/server/src/aiChat/skillImport.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { findSkillFiles, parseSkillFile, skillSlug } from './skillImport.js';

describe('SKILL.md files', () => {
  it('reads name and description from front matter, else the folder name', () => {
    expect(parseSkillFile('---\nname: api-contract\ndescription: "When writing an API"\n---\n# API\nUse OpenAPI.\n', 'x', '/s/SKILL.md')).toEqual({
      name: 'api-contract', description: 'When writing an API', body: '# API\nUse OpenAPI.', sourcePath: '/s/SKILL.md',
    });
    expect(parseSkillFile('Check criteria.\n', 'Spec Review', '/t/SKILL.md')).toEqual({ name: 'spec-review', description: '', body: 'Check criteria.', sourcePath: '/t/SKILL.md' });
    expect(skillSlug('  My_Skill!! ')).toBe('my-skill');
  });

  it('finds SKILL.md files below a folder, skipping node_modules and .git', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sp-skills-'));
    for (const rel of ['b/SKILL.md', 'a/SKILL.md', 'a/deep/c/SKILL.md', 'node_modules/p/SKILL.md', '.git/x/SKILL.md', 'a/README.md']) {
      fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true });
      fs.writeFileSync(path.join(dir, rel), 'x');
    }
    expect(findSkillFiles(dir).map((f) => path.relative(dir, f))).toEqual(['a/deep/c/SKILL.md', 'a/SKILL.md', 'b/SKILL.md']);
  });
});
```

`packages/server/src/aiChat/toolsService.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { initDatabase } from '../db/index.js';
import { SettingsService } from '../services/settingsService.js';
import { AiChatToolsService, type AiChatToolsOptions } from './toolsService.js';

const stdio = (name: string, env: Record<string, unknown> = {}) => ({ name, enabled: true, transport: 'stdio' as const, command: 'npx', args: ['-y', `${name}-mcp`], env: env as any, headers: {} });
const make = (options: AiChatToolsOptions = {}) => {
  const settings = new SettingsService(initDatabase(':memory:'));
  return { settings, tools: new AiChatToolsService(settings, { now: () => 'T', agyInfo: async () => ({ detected: false, usesMcp: true, servers: [] }), ...options }) };
};
const write = (dir: string, rel: string, text: string) => {
  fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true });
  fs.writeFileSync(path.join(dir, rel), text);
};

describe('AI Chat tools: secrets', () => {
  it('never shows secret values, and keeps them when sent back as { set: true }', async () => {
    const { tools } = make();
    tools.save({ servers: [stdio('jira', { TOKEN: 'secret-1', SITE: 'acme' })] });
    expect((await tools.view()).servers[0].env).toEqual({ TOKEN: { set: true }, SITE: { set: true } });
    tools.save({ servers: [stdio('jira', { TOKEN: { set: true }, SITE: 'acme2' })] });
    expect(tools.current().servers[0].env).toEqual({ TOKEN: 'secret-1', SITE: 'acme2' });
  });

  it('drops a kept secret of a renamed server instead of moving it', () => {
    const { tools } = make();
    tools.save({ servers: [stdio('jira', { TOKEN: 'secret-1' })] });
    tools.save({ servers: [stdio('jira2', { TOKEN: { set: true } })] });
    expect(tools.current().servers[0].env).toEqual({});
  });

  it('keeps the test result of an unchanged server and clears it when the connection changes', async () => {
    const { tools } = make({ probe: async () => ({ ok: true as const, tools: 4 }) });
    tools.save({ servers: [stdio('jira', { TOKEN: 'a' })] });
    expect(await tools.testServer('jira')).toEqual({ ok: true, tools: 4, checkedAt: 'T' });
    tools.save({ servers: [{ ...stdio('jira', { TOKEN: { set: true } }), enabled: false }] });
    expect(tools.current().servers[0].status).toEqual({ ok: true, tools: 4, checkedAt: 'T' });
    tools.save({ servers: [{ ...stdio('jira', { TOKEN: { set: true } }), command: 'node' }] });
    expect(tools.current().servers[0].status).toBeUndefined();
    await expect(tools.testServer('nope')).rejects.toMatchObject({ status: 404 });
  });
});

describe('AI Chat tools: imports', () => {
  it('adds the servers of a pasted .mcp.json, skipping names that exist or break the rules', () => {
    const { tools } = make();
    tools.save({ servers: [stdio('jira')] });
    const result = tools.importMcpJson(JSON.stringify({
      mcpServers: {
        jira: { command: 'other' },
        figma: { type: 'http', url: 'https://mcp.figma.com/mcp', headers: { Authorization: 'Bearer ${FIGMA_TOKEN}' } },
        sentry: { type: 'sse', url: 'https://mcp.sentry.dev/sse' },
        fs: { command: 'npx', args: ['-y', '@modelcontextprotocol/server-filesystem', '/work'], env: { DEBUG: '1' } },
        'bad name': { command: 'x' },
      },
    }));
    expect(result).toEqual({
      added: ['figma', 'sentry', 'fs'],
      skipped: [{ name: 'jira', reason: 'already exists' }, { name: 'bad name', reason: 'Server names use letters, digits, - and _ (up to 40)' }],
    });
    const byName = (n: string) => tools.current().servers.find((s) => s.name === n);
    expect(byName('figma')).toMatchObject({ transport: 'http', headers: { Authorization: 'Bearer ${FIGMA_TOKEN}' } });
    expect(byName('sentry')).toMatchObject({ transport: 'http', url: 'https://mcp.sentry.dev/sse' });
    expect(byName('fs')).toMatchObject({ transport: 'stdio', env: { DEBUG: '1' } });
  });

  it('refuses text that is not a .mcp.json', () => {
    const { tools } = make();
    expect(() => tools.importMcpJson('nope')).toThrow('Not a .mcp.json file');
    expect(() => tools.importMcpJson('[]')).toThrow('Not a .mcp.json file');
  });

  it('imports every SKILL.md below a folder as an editable copy, and re-imports one', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sp-skill-import-'));
    write(dir, 'api-contract/SKILL.md', '---\nname: api-contract\ndescription: When writing an API contract\n---\n# API contract\nUse OpenAPI 3.1.\n');
    write(dir, 'Spec Review/SKILL.md', 'Check acceptance criteria.\n');
    write(dir, 'create/SKILL.md', 'x');
    const { tools } = make();
    expect(tools.importSkills(dir)).toEqual({
      added: ['api-contract', 'spec-review'],
      skipped: [{ name: 'create', reason: '/create is a chat command; choose another name' }],
    });
    expect(tools.current().skills.find((s) => s.name === 'api-contract')).toEqual({
      name: 'api-contract', description: 'When writing an API contract', body: '# API contract\nUse OpenAPI 3.1.',
      mode: 'on_request', enabled: true, sourcePath: path.join(dir, 'api-contract/SKILL.md'),
    });
    expect(tools.importSkills(dir).skipped.map((s) => s.name)).toEqual(['api-contract', 'create', 'spec-review']);

    write(dir, 'api-contract/SKILL.md', '---\nname: api-contract\ndescription: New wording\n---\nUse OpenAPI 3.2.\n');
    expect(tools.reimportSkill('api-contract')).toMatchObject({ description: 'New wording', body: 'Use OpenAPI 3.2.' });
  });

  it('explains a folder without SKILL.md and a skill that was not imported', () => {
    const { tools } = make();
    const empty = fs.mkdtempSync(path.join(os.tmpdir(), 'sp-skill-empty-'));
    expect(() => tools.importSkills(empty)).toThrow(`No SKILL.md found under ${empty}`);
    expect(() => tools.importSkills(path.join(empty, 'missing'))).toThrow('Folder not found');
    tools.save({ skills: [{ name: 'house-style', body: 'British spelling' }] });
    expect(() => tools.reimportSkill('house-style')).toThrow('house-style was not imported');
  });
});

describe('AI Chat tools: AGY', () => {
  it('syncs AGY with the current servers and remembers the result', async () => {
    const seen: string[][] = [];
    const { tools } = make({ syncAgy: async (servers) => { seen.push(servers.map((s) => s.name)); return { ok: true, message: 'done', at: 'T' }; } });
    tools.save({ servers: [stdio('jira')] });
    expect(await tools.syncAgy()).toEqual({ ok: true, message: 'done', at: 'T' });
    expect(seen).toEqual([['jira']]);
    expect(tools.current().agySync).toEqual({ ok: true, message: 'done', at: 'T' });
  });
});
```

- [ ] **Step 2: Run them to see them fail**

Run: `npx vitest run packages/server/src/aiChat/skillImport.test.ts packages/server/src/aiChat/toolsService.test.ts`
Expected: FAIL (modules not found).

- [ ] **Step 3: Write `skillImport.ts`**

```ts
// SKILL.md folders (e.g. ~/.claude/skills): find them and read name, description and instructions.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const SKIP = new Set(['node_modules', '.git']);
const MAX_DEPTH = 4;

export function expandHome(p: string): string {
  const trimmed = p.trim();
  if (trimmed === '~') return os.homedir();
  return trimmed.startsWith('~/') ? path.join(os.homedir(), trimmed.slice(2)) : trimmed;
}

/** Lowercase letters, digits and -, at most 40 characters. */
export function skillSlug(raw: string): string {
  const slug = raw.toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '').slice(0, 40).replace(/-$/, '');
  return slug || 'skill';
}

export function parseSkillFile(text: string, folderName: string, sourcePath: string) {
  const match = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/.exec(text);
  const meta: Record<string, string> = {};
  if (match) {
    for (const line of match[1].split(/\r?\n/)) {
      const pair = /^([A-Za-z_][\w-]*):\s*(.*)$/.exec(line);
      if (pair) meta[pair[1]] = pair[2].trim().replace(/^["']|["']$/g, '');
    }
  }
  return { name: skillSlug(meta.name || folderName), description: meta.description ?? '', body: (match ? match[2] : text).trim(), sourcePath };
}

/** Every SKILL.md below `folder` (at most 4 levels), sorted by path. */
export function findSkillFiles(folder: string): string[] {
  const found: string[] = [];
  const walk = (dir: string, depth: number) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory() && !SKIP.has(entry.name) && depth < MAX_DEPTH) walk(full, depth + 1);
      else if (entry.isFile() && entry.name === 'SKILL.md') found.push(full);
    }
  };
  walk(folder, 0);
  return found.sort((a, b) => path.relative(folder, a).localeCompare(path.relative(folder, b)));
}
```

- [ ] **Step 4: Write `toolsService.ts`**

```ts
// Settings → AI Chat: one list of MCP servers and skills for every AI Chat message.
import fs from 'node:fs';
import path from 'node:path';
import {
  AiChatMcpServerSchema,
  AiChatSkillSchema,
  AiChatToolsUpdateInputSchema,
} from '@sp-kickstack/shared';
import type {
  AiChatAgyInfo, AiChatAgySync, AiChatImportResult, AiChatMcpServer, AiChatSecret, AiChatServerStatus, AiChatSkill,
  AiChatToolsSettings, AiChatToolsUpdateInput, AiChatToolsView,
} from '@sp-kickstack/shared';
import type { SettingsService } from '../services/settingsService.js';
import { HttpError, badRequest } from '../lib/httpError.js';
import { cliBinary } from '../localEngine/cliProfiles.js';
import { probeMcpServer, type ProbeResult } from './mcpProbe.js';
import { agyInfo, syncAgy } from './agySync.js';
import { AGY_CHAT_MCP_MODE } from './cliModes.js';
import { expandHome, findSkillFiles, parseSkillFile } from './skillImport.js';

export interface AiChatToolsOptions {
  probe?: (server: AiChatMcpServer) => Promise<ProbeResult>;
  agyInfo?: () => Promise<AiChatAgyInfo>;
  syncAgy?: (servers: AiChatMcpServer[]) => Promise<AiChatAgySync>;
  now?: () => string;
}

const mask = (values: Record<string, string>): Record<string, AiChatSecret> =>
  Object.fromEntries(Object.keys(values).map((key): [string, AiChatSecret] => [key, { set: true }]));

/** New text replaces a secret; { set: true } keeps the stored value of the same server (by name). */
const keepSecrets = (values: Record<string, AiChatSecret>, stored: Record<string, string> = {}): Record<string, string> =>
  Object.fromEntries(
    Object.entries(values).flatMap(([key, value]): Array<[string, string]> =>
      typeof value === 'string' ? [[key, value]] : key in stored ? [[key, stored[key]]] : []
    )
  );

const sameConnection = (a: AiChatMcpServer, b: AiChatMcpServer) =>
  a.transport === b.transport && a.command === b.command && a.url === b.url &&
  JSON.stringify(a.args) === JSON.stringify(b.args) && JSON.stringify(a.env) === JSON.stringify(b.env) &&
  JSON.stringify(a.headers) === JSON.stringify(b.headers);

const record = (value: unknown): Record<string, string> =>
  value && typeof value === 'object' && !Array.isArray(value)
    ? Object.fromEntries(Object.entries(value as Record<string, unknown>).map(([k, v]): [string, string] => [k, String(v)]))
    : {};

export class AiChatToolsService {
  private probe: (server: AiChatMcpServer) => Promise<ProbeResult>;
  private agyInfoFn: () => Promise<AiChatAgyInfo>;
  private syncAgyFn: (servers: AiChatMcpServer[]) => Promise<AiChatAgySync>;
  private now: () => string;

  constructor(private settings: SettingsService, options: AiChatToolsOptions = {}) {
    const agyBin = () => cliBinary('agy-cli', this.settings.getAiCliSettings());
    const usesMcp = AGY_CHAT_MCP_MODE !== 'off';
    this.probe = options.probe ?? ((server) => probeMcpServer(server));
    this.agyInfoFn = options.agyInfo ?? (() => agyInfo(agyBin(), usesMcp));
    this.syncAgyFn = options.syncAgy ?? ((servers) => syncAgy(agyBin(), servers, usesMcp));
    this.now = options.now ?? (() => new Date().toISOString());
  }

  public current(): AiChatToolsSettings {
    return this.settings.getAiChatToolsSettings();
  }

  /** What the browser gets: secrets masked, plus AGY's own list. */
  public async view(): Promise<AiChatToolsView> {
    const current = this.current();
    return {
      ...current,
      servers: current.servers.map((s) => ({ ...s, env: mask(s.env), headers: mask(s.headers) })),
      agy: await this.agyInfoFn(),
    };
  }

  public save(input: AiChatToolsUpdateInput): AiChatToolsSettings {
    const parsed = AiChatToolsUpdateInputSchema.parse(input ?? {});
    const before = this.current();
    const servers = parsed.servers.map((server) => {
      const stored = before.servers.find((s) => s.name === server.name);
      const next: AiChatMcpServer = { ...server, env: keepSecrets(server.env, stored?.env), headers: keepSecrets(server.headers, stored?.headers) };
      return stored?.status && sameConnection(stored, next) ? { ...next, status: stored.status } : next;
    });
    return this.settings.saveAiChatToolsSettings({
      timeLimitSeconds: parsed.timeLimitSeconds,
      servers,
      skills: parsed.skills,
      ...(before.agySync ? { agySync: before.agySync } : {}),
    });
  }

  /** Servers of a Claude-format .mcp.json ({ "mcpServers": { … } }); existing names are skipped. */
  public importMcpJson(text: string): AiChatImportResult {
    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch (err: any) {
      throw badRequest(`Not a .mcp.json file: ${err?.message || err}`);
    }
    const root = parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? (parsed as Record<string, any>) : null;
    const entries = root?.mcpServers && typeof root.mcpServers === 'object' ? root.mcpServers : root;
    if (!entries || Array.isArray(entries)) throw badRequest('Not a .mcp.json file: expected { "mcpServers": { … } }');

    const current = this.current();
    const result: AiChatImportResult = { added: [], skipped: [] };
    for (const [name, raw] of Object.entries(entries as Record<string, any>)) {
      if (current.servers.some((s) => s.name === name)) {
        result.skipped.push({ name, reason: 'already exists' });
        continue;
      }
      const http = typeof raw?.url === 'string' || ['http', 'sse', 'streamable-http'].includes(raw?.type);
      const candidate = http
        ? { name, enabled: true, transport: 'http', url: raw?.url, headers: record(raw?.headers) }
        : { name, enabled: true, transport: 'stdio', command: raw?.command, args: Array.isArray(raw?.args) ? raw.args.map(String) : [], env: record(raw?.env) };
      const check = AiChatMcpServerSchema.safeParse(candidate);
      if (!check.success) {
        result.skipped.push({ name, reason: check.error.issues[0]?.message ?? 'not a valid server' });
        continue;
      }
      current.servers.push(check.data);
      result.added.push(name);
    }
    this.settings.saveAiChatToolsSettings(current);
    return result;
  }

  public importSkills(folder: string): AiChatImportResult {
    const root = path.resolve(expandHome(folder));
    if (!fs.existsSync(root) || !fs.statSync(root).isDirectory()) throw badRequest(`Folder not found: ${root}`);
    const files = findSkillFiles(root);
    if (files.length === 0) throw badRequest(`No SKILL.md found under ${root}`);
    const current = this.current();
    const result: AiChatImportResult = { added: [], skipped: [] };
    for (const file of files) {
      const parsed = parseSkillFile(fs.readFileSync(file, 'utf8'), path.basename(path.dirname(file)), file);
      if (current.skills.some((s) => s.name === parsed.name)) {
        result.skipped.push({ name: parsed.name, reason: 'already exists' });
        continue;
      }
      const check = AiChatSkillSchema.safeParse({ ...parsed, mode: 'on_request', enabled: true });
      if (!check.success) {
        result.skipped.push({ name: parsed.name, reason: check.error.issues[0]?.message ?? 'not a valid skill' });
        continue;
      }
      current.skills.push(check.data);
      result.added.push(parsed.name);
    }
    this.settings.saveAiChatToolsSettings(current);
    return result;
  }

  public reimportSkill(name: string): AiChatSkill {
    const current = this.current();
    const skill = current.skills.find((s) => s.name === name);
    if (!skill) throw new HttpError(404, `No skill named ${name}`);
    if (!skill.sourcePath) throw badRequest(`${name} was not imported; edit it in Settings instead`);
    let text: string;
    try {
      text = fs.readFileSync(skill.sourcePath, 'utf8');
    } catch (err: any) {
      throw badRequest(`Cannot read ${skill.sourcePath}: ${err?.message || err}`);
    }
    const parsed = parseSkillFile(text, path.basename(path.dirname(skill.sourcePath)), skill.sourcePath);
    const next = { ...skill, description: parsed.description, body: parsed.body };
    this.settings.saveAiChatToolsSettings({ ...current, skills: current.skills.map((s) => (s.name === name ? next : s)) });
    return next;
  }

  public async testServer(name: string): Promise<AiChatServerStatus> {
    const server = this.current().servers.find((s) => s.name === name);
    if (!server) throw new HttpError(404, `No MCP server named ${name}`);
    const result = await this.probe(server);
    const status: AiChatServerStatus = result.ok
      ? { ok: true, tools: result.tools, checkedAt: this.now() }
      : { ok: false, tools: 0, error: result.error, checkedAt: this.now() };
    const latest = this.current();
    this.settings.saveAiChatToolsSettings({ ...latest, servers: latest.servers.map((s) => (s.name === name ? { ...s, status } : s)) });
    return status;
  }

  public async syncAgy(): Promise<AiChatAgySync> {
    const result = await this.syncAgyFn(this.current().servers);
    this.settings.saveAiChatToolsSettings({ ...this.current(), agySync: result });
    return result;
  }
}
```

- [ ] **Step 5: Run the tests**

Run: `npx vitest run packages/server/src/aiChat/skillImport.test.ts packages/server/src/aiChat/toolsService.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/server/src/aiChat/skillImport.ts packages/server/src/aiChat/skillImport.test.ts packages/server/src/aiChat/toolsService.ts packages/server/src/aiChat/toolsService.test.ts
git commit -m "feat(server): AI Chat tools service: masked secrets, .mcp.json and SKILL.md imports, test, AGY sync"
```

---

### Task 6: Routes

**Files:**
- Create: `packages/server/src/api/aiChatToolsRoutes.ts`
- Modify: `packages/server/src/api/app.ts` (imports near line 58; `AppDependencies`; construction after `settingsService` at line 115; registration next to `registerLocalEngineRoutes` at line 933)
- Test: `packages/server/src/aiChat/routes.test.ts`

**Interfaces:**
- Consumes: `AiChatToolsService` (Task 5).
- Produces: `GET /api/ai-chat/tools` → `AiChatToolsView`; `PUT /api/ai-chat/tools` (body `AiChatToolsUpdateInput`) → `AiChatToolsView` after an AGY sync; `POST /api/ai-chat/tools/servers/:name/test` → `AiChatServerStatus`; `POST /api/ai-chat/tools/import-mcp-json` `{ json }` → `AiChatImportResult`; `POST /api/ai-chat/tools/import-skills` `{ folder }` → `AiChatImportResult`; `POST /api/ai-chat/tools/skills/:name/reimport` → `AiChatSkill`; `POST /api/ai-chat/tools/agy-sync` → `AiChatAgySync`. `AppDependencies.aiChatTools?: AiChatToolsService`.

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from 'vitest';
import { initDatabase } from '../db/index.js';
import { ProjectService } from '../services/projectService.js';
import { RequirementService } from '../services/requirementService.js';
import { FanOutService } from '../services/fanOutService.js';
import { LinkService } from '../services/linkService.js';
import { TicketService } from '../services/ticketService.js';
import { WorkspaceService } from '../services/workspaceService.js';
import { SettingsService } from '../services/settingsService.js';
import { ManualAdapter } from '../adapters/manualAdapter.js';
import { createApp } from '../api/app.js';
import { testRequest } from '../api/testHelper.js';
import { SseBroadcaster } from '../sse/broadcaster.js';
import { Notifier } from '../notify/notifier.js';
import { AiChatToolsService } from './toolsService.js';

function app() {
  const db = initDatabase(':memory:');
  const settings = new SettingsService(db);
  const syncs: string[][] = [];
  const aiChatTools = new AiChatToolsService(settings, {
    now: () => 'T',
    probe: async () => ({ ok: false as const, error: 'spawn x ENOENT' }),
    agyInfo: async () => ({ detected: true, usesMcp: true, servers: [{ name: 'chrome-devtools-mcp', type: 'stdio', status: 'enabled', target: 'npx' }] }),
    syncAgy: async (servers) => { syncs.push(servers.map((s) => s.name)); return { ok: true, message: 'synced', at: 'T' }; },
  });
  const projectService = new ProjectService(db);
  const requirementService = new RequirementService(db);
  const getAdapter = () => new ManualAdapter() as any;
  const linkService = new LinkService(db, projectService, getAdapter);
  const ticketService = new TicketService(db, projectService, linkService, getAdapter);
  const fanOutService = new FanOutService(db, projectService, requirementService, getAdapter);
  const express = createApp({
    db, workspaceService: new WorkspaceService(db), projectService, requirementService, fanOutService, linkService, ticketService,
    broadcaster: new SseBroadcaster(), notifier: new Notifier(), settingsService: settings, aiChatTools,
  });
  return { express, syncs };
}

describe('AI Chat tools API', () => {
  it('saves servers, masks secrets, syncs AGY and tests a server', async () => {
    const { express, syncs } = app();
    const saved = await testRequest(express, 'PUT', '/api/ai-chat/tools', {
      body: { servers: [{ name: 'jira', transport: 'stdio', command: 'npx', env: { TOKEN: 'secret' } }], skills: [] },
    });
    expect(saved.status).toBe(200);
    expect(saved.body.servers[0].env).toEqual({ TOKEN: { set: true } });
    expect(saved.body.agy.servers[0].name).toBe('chrome-devtools-mcp');
    expect(syncs).toEqual([['jira']]);
    expect(JSON.stringify((await testRequest(express, 'GET', '/api/ai-chat/tools')).body)).not.toContain('secret');
    expect((await testRequest(express, 'POST', '/api/ai-chat/tools/servers/jira/test')).body).toEqual({ ok: false, tools: 0, error: 'spawn x ENOENT', checkedAt: 'T' });
    expect((await testRequest(express, 'POST', '/api/ai-chat/tools/servers/nope/test')).status).toBe(404);
  });

  it('refuses a bad server, imports a .mcp.json and explains bad JSON', async () => {
    const { express } = app();
    expect((await testRequest(express, 'PUT', '/api/ai-chat/tools', { body: { servers: [{ name: 'x', transport: 'http' }] } })).status).toBe(400);
    const imported = await testRequest(express, 'POST', '/api/ai-chat/tools/import-mcp-json', { body: { json: '{"mcpServers":{"fs":{"command":"npx"}}}' } });
    expect(imported.body).toEqual({ added: ['fs'], skipped: [] });
    const bad = await testRequest(express, 'POST', '/api/ai-chat/tools/import-mcp-json', { body: { json: 'nope' } });
    expect(bad.status).toBe(400);
    expect(bad.body.error).toContain('Not a .mcp.json file');
    expect((await testRequest(express, 'POST', '/api/ai-chat/tools/agy-sync')).body).toEqual({ ok: true, message: 'synced', at: 'T' });
  });
});
```

- [ ] **Step 2: Run it to see it fail**

Run: `npx vitest run packages/server/src/aiChat/routes.test.ts`
Expected: FAIL (404 for `/api/ai-chat/tools`).

- [ ] **Step 3: Write the routes**

```ts
import type { Express } from 'express';
import type { SseBroadcaster } from '../sse/broadcaster.js';
import type { AiChatToolsService } from '../aiChat/toolsService.js';

export interface AiChatToolsRouteDeps {
  tools: AiChatToolsService;
  broadcaster: SseBroadcaster;
}

/** Settings → AI Chat: MCP servers and skills for the AI chats. Secrets are never returned. */
export function registerAiChatToolsRoutes(app: Express, deps: AiChatToolsRouteDeps) {
  const { tools } = deps;
  const changed = () => deps.broadcaster.broadcast({ type: 'settings_updated', payload: { ai_chat_tools: true } });

  app.get('/api/ai-chat/tools', async (_req, res, next) => {
    try {
      res.json(await tools.view());
    } catch (err) {
      next(err);
    }
  });

  app.put('/api/ai-chat/tools', async (req, res, next) => {
    try {
      tools.save(req.body ?? {});
      await tools.syncAgy();
      changed();
      res.json(await tools.view());
    } catch (err) {
      next(err);
    }
  });

  app.post('/api/ai-chat/tools/servers/:name/test', async (req, res, next) => {
    try {
      res.json(await tools.testServer(req.params.name));
    } catch (err) {
      next(err);
    }
  });

  app.post('/api/ai-chat/tools/import-mcp-json', async (req, res, next) => {
    try {
      const result = tools.importMcpJson(String(req.body?.json ?? ''));
      if (result.added.length) await tools.syncAgy();
      changed();
      res.json(result);
    } catch (err) {
      next(err);
    }
  });

  app.post('/api/ai-chat/tools/import-skills', (req, res, next) => {
    try {
      const result = tools.importSkills(String(req.body?.folder ?? ''));
      changed();
      res.json(result);
    } catch (err) {
      next(err);
    }
  });

  app.post('/api/ai-chat/tools/skills/:name/reimport', (req, res, next) => {
    try {
      res.json(tools.reimportSkill(req.params.name));
    } catch (err) {
      next(err);
    }
  });

  app.post('/api/ai-chat/tools/agy-sync', async (_req, res, next) => {
    try {
      res.json(await tools.syncAgy());
    } catch (err) {
      next(err);
    }
  });
}
```

- [ ] **Step 4: Wire it in `app.ts`**

Add the imports next to `registerHumanLoopRoutes`:

```ts
import { registerAiChatToolsRoutes } from './aiChatToolsRoutes.js';
import { AiChatToolsService } from '../aiChat/toolsService.js';
```

Add to `interface AppDependencies`:

```ts
  aiChatTools?: AiChatToolsService;
```

After `const settingsService = deps.settingsService || new SettingsService(deps.db);`:

```ts
  const aiChatTools = deps.aiChatTools || new AiChatToolsService(settingsService);
```

After `registerLocalEngineRoutes(app, …);`:

```ts
  registerAiChatToolsRoutes(app, { tools: aiChatTools, broadcaster: deps.broadcaster });
```

- [ ] **Step 5: Run the test and the server typecheck**

Run: `npx vitest run packages/server/src/aiChat/routes.test.ts && npx tsc --noEmit -p packages/server`
Expected: PASS, no type errors.

- [ ] **Step 6: Commit**

```bash
git add packages/server/src/api/aiChatToolsRoutes.ts packages/server/src/api/app.ts packages/server/src/aiChat/routes.test.ts
git commit -m "feat(server): AI Chat tools API (servers, skills, imports, test, AGY sync)"
```

---

### Task 7: Parsers report tool names and the final reply

**Files:**
- Modify: `packages/server/src/localEngine/outputParsers.ts` (`ParsedOutput`, `claudeParser`, `agyParser`)
- Modify: `packages/server/src/localEngine/outputParsers.test.ts:20-21` (the `result` event now also carries `reply`)
- Test: `packages/server/src/aiChat/chatStream.test.ts` (new)

**Interfaces:**
- Consumes: fixtures from Task 1.
- Produces: `ParsedOutput.tools?: string[]` (raw tool names in an event) and `ParsedOutput.reply?: string` (final answer text, on the closing event).

- [ ] **Step 1: Write the failing test**

```ts
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

  it('AGY: tool steps and the answer after the last tool', () => {
    const { tools, reply } = read(agyParser(), fixture('agy-mcp-turn.jsonl'));
    expect(tools.length).toBeGreaterThan(0);
    expect(reply?.trim()).toContain('ping');
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
```

(If Task 1 found AGY's `agy-mcp-turn.jsonl` has no tool step because AGY mode is `off`, replace the second test's `toBeGreaterThan(0)` with `toEqual([])`.)

- [ ] **Step 2: Run it to see it fail**

Run: `npx vitest run packages/server/src/aiChat/chatStream.test.ts`
Expected: FAIL (`tools` is empty, `reply` undefined).

- [ ] **Step 3: Extend the parsers**

In `ParsedOutput` add:

```ts
  /** Tool names the CLI called in this event (raw, e.g. mcp__jira__search_issues). */
  tools?: string[];
  /** The final answer text (on the closing event). */
  reply?: string;
```

In `claudeParser`, case `'assistant'`:

```ts
        case 'assistant': {
          const out: string[] = [];
          const tools: string[] = [];
          for (const part of e.message?.content ?? []) {
            if (part?.type === 'text' && typeof part.text === 'string') out.push(...lines(part.text));
            else if (part?.type === 'tool_use') {
              tools.push(String(part.name ?? 'tool'));
              out.push(describeTool(String(part.name ?? 'tool'), part.input));
            }
          }
          return { logs: out, ...(tools.length ? { tools } : {}) };
        }
```

In `claudeParser`, case `'result'`, replace `if (!e.is_error) return { logs: [summary] };` with:

```ts
          if (!e.is_error) return { logs: [summary], ...(typeof e.result === 'string' ? { reply: e.result } : {}) };
```

In `agyParser`, keep every answer step's text and the last tool step:

```ts
export function agyParser(): OutputParser {
  const text = new Map<number, string>();
  const answer = new Map<number, string>();
  const seenTools = new Set<number>();
  let lastTool = -1;
  const flushStep = (index: number): string[] => {
    const buffered = text.get(index);
    text.delete(index);
    return buffered ? lines(buffered) : [];
  };
  const flushAll = () => [...text.keys()].flatMap(flushStep);
  /** The answer: text of the answer steps after the last tool step (all of them when none follow). */
  const reply = () => {
    const steps = [...answer.entries()].sort(([a], [b]) => a - b);
    const after = steps.filter(([index]) => index > lastTool);
    return (after.length ? after : steps).map(([, t]) => t.trim()).filter(Boolean).join('\n\n');
  };
  return {
    push(line) {
      const e = parseJson(line);
      if (!e) return plain(line);
      if (e.event === 'init') return { logs: [`Agent started: AGY${e.init?.permission_mode ? ` · ${e.init.permission_mode}` : ''}`] };
      if (e.event === 'step_update') {
        const step = e.step_update ?? {};
        const index = Number(step.step_index);
        if (step.step_type === 'agent_response') {
          if (typeof step.text_delta === 'string') {
            text.set(index, (text.get(index) ?? '') + step.text_delta);
            answer.set(index, (answer.get(index) ?? '') + step.text_delta);
          }
          return step.state === 'DONE' ? { logs: flushStep(index) } : NONE;
        }
        if (step.step_type === 'tool' && !seenTools.has(index)) {
          seenTools.add(index);
          lastTool = Math.max(lastTool, index);
          const name = String(step.tool_name ?? step.tool_info?.name ?? 'tool');
          return { logs: [describeTool(name, step.tool_info?.parameters)], tools: [name] };
        }
        return NONE;
      }
      if (e.event === 'result') {
        const result = e.result ?? {};
        const pending = flushAll();
        const status = result.status === undefined ? 'SUCCESS' : String(result.status);
        const summary = `Finished: ${status.toLowerCase()}${typeof result.duration_seconds === 'number' ? ` · ${Math.round(result.duration_seconds)} s` : ''}`;
        if (status === 'SUCCESS') {
          const answerText = reply();
          return { logs: [...pending, summary], ...(answerText ? { reply: answerText } : {}) };
        }
        const failed = failure(String(result.error ?? result.message ?? result.response ?? `AGY finished with status ${status}`));
        return { ...failed, logs: [...pending, summary, ...failed.logs] };
      }
      if (e.event === 'error') return failure(String(e.error?.message ?? e.message ?? JSON.stringify(e)));
      return NONE;
    },
    flush: () => ({ logs: flushAll() }),
  };
}
```

In `outputParsers.test.ts:20-21`, the success `result` event now also returns the reply:

```ts
    expect(p.push(j({ type: 'result', subtype: 'success', is_error: false, result: 'OK', num_turns: 3, duration_ms: 12400, total_cost_usd: 0.4 })))
      .toEqual({ logs: ['Finished: success · 3 turns · 12 s · $0.40'], reply: 'OK' });
```

- [ ] **Step 4: Run the parser tests**

Run: `npx vitest run packages/server/src/aiChat/chatStream.test.ts packages/server/src/localEngine`
Expected: PASS (the agent runner ignores the new fields).

- [ ] **Step 5: Commit**

```bash
git add packages/server/src/localEngine/outputParsers.ts packages/server/src/localEngine/outputParsers.test.ts packages/server/src/aiChat/chatStream.test.ts
git commit -m "feat(server): output parsers report tool names and the final reply"
```

---

### Task 8: Chat turns use the servers and skills

**Files:**
- Create: `packages/server/src/aiChat/chatTools.ts`, `packages/server/src/testing/fakeChatCli.mjs`
- Modify: `packages/server/src/services/aiChatService.ts` (imports; `chat()` provider calls; `chatWithClaudeCli`; `chatWithAgyCli`; `sendSessionMessage` insert/return; `getSession` mapping)
- Test: `packages/server/src/aiChat/chatTools.test.ts`, `packages/server/src/aiChat/chatTurn.test.ts`

**Interfaces:**
- Consumes: `getAiChatToolsSettings` (Task 2); `claudeParser`, `agyParser` with `tools`/`reply` (Task 7); `CLAUDE_CHAT_PERMISSION`, `AGY_CHAT_MCP_MODE`, `AgyChatMcpMode`, `ClaudeChatPermission` (Task 1).
- Produces: `enabledServers`, `claudeMcpConfig`, `writeMcpConfig(servers) → { dir, file, cleanup }`, `claudeChatArgs(o)`, `agyChatArgs(o)`, `chatFolder(sessionId?)`, `requestedSkills(text, skills)`, `skillsPrompt(skills, requested)`, `toolLabel(raw)`, `countTools(names)`, `readChatStream(cli, stdout)`, `SKILLS_PROMPT_MAX = 30_000`; replies carry `message.tools_used`.

- [ ] **Step 1: Write the failing unit test** (`chatTools.test.ts`)

```ts
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import type { AiChatMcpServer, AiChatSkill } from '@sp-kickstack/shared';
import { agyChatArgs, claudeChatArgs, countTools, requestedSkills, skillsPrompt, SKILLS_PROMPT_MAX, toolLabel, writeMcpConfig } from './chatTools.js';

const jira: AiChatMcpServer = { name: 'jira', enabled: true, transport: 'stdio', command: 'npx', args: ['jira-mcp'], env: { T: 's' }, headers: {} };
const figma: AiChatMcpServer = { name: 'figma', enabled: true, transport: 'http', url: 'https://f/mcp', args: [], env: {}, headers: { Authorization: 'Bearer x' } };
const skill = (name: string, over: Partial<AiChatSkill> = {}): AiChatSkill => ({ name, description: `when ${name}`, body: `do ${name}`, mode: 'on_request', enabled: true, ...over });

describe('chat tools', () => {
  it('writes an owner-only MCP config file and removes it', () => {
    const config = writeMcpConfig([jira, figma]);
    expect((fs.statSync(config.file).mode & 0o777).toString(8)).toBe('600');
    expect(JSON.parse(fs.readFileSync(config.file, 'utf8'))).toEqual({
      mcpServers: {
        jira: { type: 'stdio', command: 'npx', args: ['jira-mcp'], env: { T: 's' } },
        figma: { type: 'http', url: 'https://f/mcp', headers: { Authorization: 'Bearer x' } },
      },
    });
    config.cleanup();
    expect(fs.existsSync(config.file)).toBe(false);
  });

  it('builds Claude Code arguments: strict servers, or today\'s command without servers', () => {
    expect(claudeChatArgs({ prompt: 'P', servers: [jira, figma], mcpFile: '/t/mcp.json', permission: 'allowed-tools', model: 'sonnet' })).toEqual([
      '-p', 'P', '--output-format', 'stream-json', '--verbose', '--tools', '', '--mcp-config', '/t/mcp.json', '--strict-mcp-config',
      '--allowedTools', 'mcp__jira', 'mcp__figma', '--model', 'sonnet',
    ]);
    expect(claudeChatArgs({ prompt: 'P', servers: [jira], mcpFile: '/t/mcp.json', permission: 'bypass' })).toContain('bypassPermissions');
    expect(claudeChatArgs({ prompt: 'P', servers: [], permission: 'allowed-tools', sessionId: 'chat-1' })).toEqual(['-p', 'P', '--tools', '', '--session-id', 'chat-1']);
  });

  it('builds AGY arguments for each mode', () => {
    expect(agyChatArgs({ prompt: 'P', mode: 'native' })).toEqual(['-p', 'P', '--output-format', 'stream-json']);
    expect(agyChatArgs({ prompt: 'P', mode: 'sandbox' })).toContain('--sandbox');
    expect(agyChatArgs({ prompt: 'P', mode: 'skip-permissions-sandboxed', effort: 'high' })).toEqual([
      '-p', 'P', '--output-format', 'stream-json', '--dangerously-skip-permissions', '--sandbox', '--effort', 'high',
    ]);
  });

  it('finds /skill requests: enabled skills only, at a word start, not paths', () => {
    const skills = [skill('api-contract'), skill('old-skill', { enabled: false }), skill('api')];
    expect(requestedSkills('Draft it /api-contract please', skills)).toEqual(['api-contract']);
    expect(requestedSkills('see /api/users and /old-skill', skills)).toEqual([]);
    expect(requestedSkills('/api, then /api-contract.', skills)).toEqual(['api', 'api-contract']);
  });

  it('puts requested and Always skills into the prompt, capped, imported text marked untrusted', () => {
    const skills = [skill('house', { mode: 'always' }), skill('api-contract', { sourcePath: '/s/SKILL.md' }), skill('unused')];
    const text = skillsPrompt(skills, ['api-contract']);
    expect(text).toContain('## Skills');
    expect(text.indexOf('### api-contract')).toBeLessThan(text.indexOf('### house'));
    expect(text).toContain('<untrusted_input name="skill api-contract">\ndo api-contract\n</untrusted_input>');
    expect(text).not.toContain('unused');
    expect(skillsPrompt([skill('a', { mode: 'always' })], [])).toContain('### a — when a\ndo a');
    expect(skillsPrompt([skill('x', { mode: 'always', enabled: false })], [])).toBe('');
    const big = skillsPrompt([skill('huge', { mode: 'always', body: 'x'.repeat(SKILLS_PROMPT_MAX) }), skill('small', { mode: 'always' })], []);
    expect(big).toContain('### small');
    expect(big).toContain('(not included: too long) huge');
  });

  it('labels tools as server.tool and counts them', () => {
    expect(toolLabel('mcp__jira__search_issues')).toBe('jira.search_issues');
    expect(toolLabel('sp-jira/search')).toBe('jira.search');
    expect(toolLabel('Bash')).toBe('Bash');
    expect(countTools(['mcp__jira__search', 'mcp__figma__frame', 'mcp__jira__search'])).toEqual([
      { tool: 'jira.search', count: 2 },
      { tool: 'figma.frame', count: 1 },
    ]);
  });
});
```

(If Task 1 recorded an AGY tool name in another shape, add it to this test as `expect(toolLabel('<recorded name>')).toBe('probe.echo')` and extend `toolLabel` to match.)

- [ ] **Step 2: Run it to see it fail**

Run: `npx vitest run packages/server/src/aiChat/chatTools.test.ts`
Expected: FAIL ("Failed to load url ./chatTools.js").

- [ ] **Step 3: Write `chatTools.ts`**

```ts
// AI Chat turns with the MCP servers and skills from Settings → AI Chat.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { AiChatMcpServer, AiChatSkill, AiChatToolUse } from '@sp-kickstack/shared';
import { wrapUntrusted } from '../lib/promptSafety.js';
import { agyParser, claudeParser } from '../localEngine/outputParsers.js';
import type { AgyChatMcpMode, ClaudeChatPermission } from './cliModes.js';

export const SKILLS_PROMPT_MAX = 30_000;

export const enabledServers = (servers: AiChatMcpServer[]) => servers.filter((s) => s.enabled);

export function claudeMcpConfig(servers: AiChatMcpServer[]) {
  return {
    mcpServers: Object.fromEntries(
      servers.map((s): [string, Record<string, unknown>] => [
        s.name,
        s.transport === 'http' ? { type: 'http', url: s.url, headers: s.headers } : { type: 'stdio', command: s.command, args: s.args, env: s.env },
      ])
    ),
  };
}

/** One turn's MCP config (it holds secrets): owner-only; call cleanup() in finally. */
export function writeMcpConfig(servers: AiChatMcpServer[]): { dir: string; file: string; cleanup: () => void } {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sp-chat-mcp-'));
  const file = path.join(dir, 'mcp.json');
  fs.writeFileSync(file, JSON.stringify(claudeMcpConfig(servers)), { mode: 0o600 });
  return { dir, file, cleanup: () => fs.rmSync(dir, { recursive: true, force: true }) };
}

/** A chat's own empty folder: the CLI runs there (not in the bridge's folder) and keeps its conversation. */
export function chatFolder(sessionId?: string): string {
  const dir = path.join(os.tmpdir(), 'sp-kickstack-chat', sessionId || 'once');
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

export function claudeChatArgs(o: {
  prompt: string;
  servers: AiChatMcpServer[];
  mcpFile?: string;
  permission: ClaudeChatPermission;
  sessionId?: string;
  model?: string | null;
  effort?: string | null;
}): string[] {
  const tools =
    o.mcpFile && o.servers.length
      ? [
          '--output-format', 'stream-json', '--verbose', '--tools', '', '--mcp-config', o.mcpFile, '--strict-mcp-config',
          ...(o.permission === 'bypass' ? ['--permission-mode', 'bypassPermissions'] : ['--allowedTools', ...o.servers.map((s) => `mcp__${s.name}`)]),
        ]
      : ['--tools', ''];
  return [
    '-p', o.prompt, ...tools,
    ...(o.sessionId ? ['--session-id', o.sessionId] : []),
    ...(o.model ? ['--model', o.model] : []),
    ...(o.effort ? ['--effort', o.effort] : []),
  ];
}

export function agyChatArgs(o: { prompt: string; mode: AgyChatMcpMode; sessionId?: string; model?: string | null; effort?: string | null }): string[] {
  const permission =
    o.mode === 'skip-permissions-sandboxed' ? ['--dangerously-skip-permissions', '--sandbox'] : o.mode === 'sandbox' ? ['--sandbox'] : [];
  return [
    '-p', o.prompt, '--output-format', 'stream-json', ...permission,
    ...(o.sessionId ? ['--conversation', o.sessionId] : []),
    ...(o.model ? ['--model', o.model] : []),
    ...(o.effort ? ['--effort', o.effort] : []),
  ];
}

/** `/name` of enabled skills, at the start of a word and not followed by `/` (so `/api/users` is not one). */
export function requestedSkills(text: string, skills: AiChatSkill[]): string[] {
  const enabled = new Set(skills.filter((s) => s.enabled).map((s) => s.name));
  const names: string[] = [];
  for (const match of text.matchAll(/(?:^|\s)\/([a-z0-9][a-z0-9-]{0,39})(?=$|[\s.,;:!?)])/g)) {
    if (enabled.has(match[1]) && !names.includes(match[1])) names.push(match[1]);
  }
  return names;
}

/** "## Skills": requested skills first, then Always ones, at most SKILLS_PROMPT_MAX characters. */
export function skillsPrompt(skills: AiChatSkill[], requested: string[]): string {
  const enabled = skills.filter((s) => s.enabled);
  const chosen = [
    ...requested.map((name) => enabled.find((s) => s.name === name)).filter((s): s is AiChatSkill => Boolean(s)),
    ...enabled.filter((s) => s.mode === 'always' && !requested.includes(s.name)),
  ];
  if (chosen.length === 0) return '';
  const parts: string[] = [];
  const left: string[] = [];
  let size = 0;
  for (const s of chosen) {
    const body = s.sourcePath ? wrapUntrusted(`skill ${s.name}`, s.body) : s.body;
    const part = `### ${s.name}${s.description ? ` — ${s.description}` : ''}\n${body}`;
    if (size + part.length > SKILLS_PROMPT_MAX) {
      left.push(s.name);
      continue;
    }
    parts.push(part);
    size += part.length;
  }
  return `## Skills\n${parts.join('\n\n')}${left.length ? `\n\n(not included: too long) ${left.join(', ')}` : ''}`;
}

/** `mcp__jira__search` → `jira.search`; `sp-jira/search` → `jira.search`; others as they are. */
export function toolLabel(raw: string): string {
  const name = raw.trim();
  const mcp = /^mcp__(.+?)__(.+)$/.exec(name);
  if (mcp) return `${mcp[1].replace(/^sp-/, '')}.${mcp[2]}`;
  const split = /^([^/.:]+)[/.:](.+)$/.exec(name);
  return split ? `${split[1].replace(/^sp-/, '')}.${split[2]}` : name;
}

export function countTools(names: string[]): AiChatToolUse[] {
  const counts = new Map<string, number>();
  for (const label of names.map(toolLabel)) counts.set(label, (counts.get(label) ?? 0) + 1);
  return [...counts].map(([tool, count]) => ({ tool, count }));
}

/** The reply text, tool names and the CLI's own error from a stream-json run. */
export function readChatStream(cli: 'claude-cli' | 'agy-cli', stdout: string): { reply: string | null; tools: string[]; error?: string } {
  const parser = cli === 'claude-cli' ? claudeParser() : agyParser();
  const tools: string[] = [];
  let reply: string | null = null;
  let error: string | undefined;
  for (const out of [...stdout.split('\n').filter((l) => l.trim()).map((l) => parser.push(l.trim())), parser.flush()]) {
    tools.push(...(out.tools ?? []));
    if (out.reply !== undefined) reply = out.reply;
    if (out.error) error = out.error;
  }
  return { reply, tools, error };
}
```

- [ ] **Step 4: Run the unit test**

Run: `npx vitest run packages/server/src/aiChat/chatTools.test.ts`
Expected: PASS.

- [ ] **Step 5: Write the fake chat CLI** (`packages/server/src/testing/fakeChatCli.mjs`, `chmod +x`)

```js
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
    out({ event: 'step_update', step_update: { step_index: 1, step_type: 'tool', tool_name: 'sp-jira/search_issues', tool_info: { name: 'sp-jira/search_issues', parameters: {} } } });
    out({ event: 'step_update', step_update: { step_index: 2, state: 'DONE', step_type: 'agent_response', text_delta: 'Found 2 issues.' } });
    out({ event: 'result', result: { status: 'SUCCESS' } });
  } else {
    process.stdout.write('Plain answer.\n');
  }
}, Number(process.env.FAKE_CHAT_SLEEP_MS || 0));
```

(Use the AGY tool-name shape recorded in Task 1 for `tool_name` if it differs from `sp-jira/search_issues`.)

- [ ] **Step 6: Write the failing chat-turn test** (`chatTurn.test.ts`)

```ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { initDatabase, type AppDatabase } from '../db/index.js';
import { ProjectService } from '../services/projectService.js';
import { SettingsService } from '../services/settingsService.js';
import { AiChatService } from '../services/aiChatService.js';
import { AGY_CHAT_MCP_MODE } from './cliModes.js';

const FAKE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../testing/fakeChatCli.mjs');
let db: AppDatabase;
let settings: SettingsService;
let chat: AiChatService;
let log: string;
const records = () => fs.readFileSync(log, 'utf8').trim().split('\n').map((l) => JSON.parse(l));
const jira = { name: 'jira', enabled: true, transport: 'stdio' as const, command: 'npx', args: ['jira-mcp'], env: { TOKEN: 'secret' }, headers: {} };
const figma = { name: 'figma', enabled: true, transport: 'http' as const, url: 'https://f/mcp', args: [], env: {}, headers: {} };
const sentry = { ...jira, name: 'sentry', enabled: false };

beforeEach(() => {
  fs.chmodSync(FAKE, 0o755);
  db = initDatabase(':memory:');
  settings = new SettingsService(db);
  settings.updateAiCliSettings({ claude: { customPath: FAKE } as any, agy: { customPath: FAKE } as any });
  chat = new AiChatService(db, new ProjectService(db), settings);
  log = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'sp-chat-log-')), 'log');
  process.env.FAKE_CHAT_LOG = log;
  delete process.env.FAKE_CHAT_SLEEP_MS;
});
afterEach(() => db.close());

describe('AI Chat turns with MCP servers and skills', () => {
  it('gives Claude Code only the enabled servers, then saves the tools used', async () => {
    settings.saveAiChatToolsSettings({ timeLimitSeconds: 30, servers: [jira, figma, sentry], skills: [] });
    const session = chat.createSession({ provider: 'claude-cli' });
    const result = await chat.sendSessionMessage(session.id, { content: 'Find open bugs' });

    expect(result.message.content).toBe('Found 2 issues.');
    const used = [{ tool: 'jira.search_issues', count: 2 }, { tool: 'figma.get_frame', count: 1 }];
    expect(result.message.tools_used).toEqual(used);
    expect(chat.getSession(session.id)!.messages.at(-1)!.tools_used).toEqual(used);
    const [run] = records();
    expect(run.argv).toEqual(expect.arrayContaining(['--strict-mcp-config', '--allowedTools', 'mcp__jira', 'mcp__figma']));
    expect(run.argv).not.toContain('mcp__sentry');
    expect(run.mcp.mode).toBe('600');
    expect(Object.keys(run.mcp.content.mcpServers)).toEqual(['jira', 'figma']);
    expect(run.mcp.content.mcpServers.jira.env).toEqual({ TOKEN: 'secret' });
    expect(fs.existsSync(run.mcp.file)).toBe(false);
  });

  it('runs Claude Code as today when no server is enabled', async () => {
    const session = chat.createSession({ provider: 'claude-cli' });
    const result = await chat.sendSessionMessage(session.id, { content: 'Hello' });
    expect(result.message.content).toBe('Plain answer.');
    expect(result.message.tools_used).toBeUndefined();
    expect(records()[0].argv).toEqual(expect.arrayContaining(['--tools', '']));
    expect(records()[0].argv).not.toContain('--mcp-config');
  });

  it('adds Always skills and the /skill asked for to the prompt', async () => {
    settings.saveAiChatToolsSettings({
      timeLimitSeconds: 30,
      servers: [],
      skills: [
        { name: 'house-style', description: 'always', body: 'Use British spelling', mode: 'always', enabled: true },
        { name: 'api-contract', description: 'for APIs', body: 'Use OpenAPI 3.1', mode: 'on_request', enabled: true },
        { name: 'unused', description: '', body: 'Never shown', mode: 'on_request', enabled: true },
      ],
    });
    const session = chat.createSession({ provider: 'claude-cli' });
    await chat.sendSessionMessage(session.id, { content: 'Draft the API /api-contract please' });
    const prompt = records()[0].argv[1] as string;
    expect(prompt).toContain('## Skills');
    expect(prompt).toContain('Use OpenAPI 3.1');
    expect(prompt).toContain('Use British spelling');
    expect(prompt).not.toContain('Never shown');
  });

  it('ends a turn that runs out of time, and still removes the MCP config', async () => {
    settings.saveAiChatToolsSettings({ timeLimitSeconds: 5, servers: [jira], skills: [] });
    process.env.FAKE_CHAT_SLEEP_MS = '8000';
    const session = chat.createSession({ provider: 'claude-cli' });
    const result = await chat.sendSessionMessage(session.id, { content: 'Slow one' });
    expect(result.message.content).toContain('The AI did not answer within 5 s');
    expect(fs.existsSync(records()[0].mcp.file)).toBe(false);
  }, 20_000);

  it("runs AGY in stream-json in the chat's own folder and saves the tools used", async () => {
    const session = chat.createSession({ provider: 'agy-cli' });
    const result = await chat.sendSessionMessage(session.id, { content: 'Find open bugs' });
    expect(result.message.content).toBe('Found 2 issues.');
    expect(result.message.tools_used).toEqual([{ tool: 'jira.search_issues', count: 1 }]);
    const [run] = records();
    expect(run.argv).toEqual(expect.arrayContaining(['--output-format', 'stream-json']));
    expect(run.argv.includes('--dangerously-skip-permissions')).toBe(AGY_CHAT_MCP_MODE === 'skip-permissions-sandboxed');
    expect(run.cwd.endsWith(path.join('sp-kickstack-chat', session.id))).toBe(true);
  });
});
```

- [ ] **Step 7: Run it to see it fail**

Run: `npx vitest run packages/server/src/aiChat/chatTurn.test.ts`
Expected: FAIL (no `--mcp-config`, no `tools_used`, the timeout falls back to the heuristic answer).

- [ ] **Step 8: Change `AiChatService`**

Imports (top of `aiChatService.ts`):

```ts
import { AiChatToolsSettingsSchema } from '@sp-kickstack/shared';
import type { AiChatToolsSettings } from '@sp-kickstack/shared';
import {
  agyChatArgs, chatFolder, claudeChatArgs, countTools, enabledServers, readChatStream, requestedSkills, skillsPrompt, writeMcpConfig,
} from '../aiChat/chatTools.js';
import { AGY_CHAT_MCP_MODE, CLAUDE_CHAT_PERMISSION } from '../aiChat/cliModes.js';
```

In `chat()`, right after the `systemPrompt` template literal ends, add the skills and replace the two CLI calls:

```ts
    const tools = this.chatTools();
    const lastUser = [...req.messages].reverse().find((m) => m.role === 'user')?.content ?? '';
    const skills = skillsPrompt(tools.skills, requestedSkills(lastUser, tools.skills));
    const prompt = skills ? `${systemPrompt}\n\n${skills}` : systemPrompt;

    // 1. Try Claude CLI with session continuity
    if (provider === 'claude-cli') {
      const claudeBin = cliSettings?.claude?.customPath || findCliBinary('claude');
      if (claudeBin) {
        try {
          return await this.chatWithClaudeCli(req, prompt, claudeBin, cliSettings, sessionId, tools);
        } catch (err: any) {
          if (err?.timedOut) return this.timedOut(tools.timeLimitSeconds, 'Claude Code');
          // Fall back to heuristic / grounded browser assistant
        }
      }
    }

    // 2. Try Agy CLI with session continuity
    if (provider === 'agy-cli') {
      const agyBin = cliSettings?.agy?.customPath || findCliBinary('agy');
      if (agyBin) {
        try {
          return await this.chatWithAgyCli(req, prompt, agyBin, cliSettings, sessionId, tools);
        } catch (err: any) {
          if (err?.timedOut) return this.timedOut(tools.timeLimitSeconds, 'AGY');
          // Fall back to heuristic / grounded browser assistant
        }
      }
    }
```

In the Ollama branch, send the skills too: replace `messages: [{ role: 'user', content: rawLastUser }],` with

```ts
            messages: [{ role: 'user', content: skills ? `${skills}\n\n${rawLastUser}` : rawLastUser }],
```

Add these private methods to the class:

```ts
  private chatTools(): AiChatToolsSettings {
    return this.settingsService?.getAiChatToolsSettings() ?? AiChatToolsSettingsSchema.parse({});
  }

  private timedOut(seconds: number, cli: string): AiChatResponse {
    return {
      message: {
        id: `msg-${Date.now()}`,
        role: 'assistant',
        content: `The AI did not answer within ${seconds} s. Try again, or raise the chat time limit in Settings → AI Chat.`,
        timestamp: new Date().toISOString(),
      },
      provider_used: `${cli} (timed out)`,
    };
  }
```

Replace `chatWithClaudeCli` with:

```ts
  private async chatWithClaudeCli(
    req: AiChatRequest,
    systemPrompt: string,
    binPath: string,
    cliSettings: any,
    sessionId: string | undefined,
    tools: AiChatToolsSettings
  ): Promise<AiChatResponse> {
    const model = req.model || cliSettings?.claude?.model || 'sonnet';
    const effort = req.effort || cliSettings?.claude?.effort || 'medium';
    const fullPrompt = `${systemPrompt}\n\n## Conversation History:\n${this.formatTranscript(req.messages)}\n\nArchitect:`;
    const servers = enabledServers(tools.servers);
    const config = servers.length ? writeMcpConfig(servers) : null;
    try {
      const args = claudeChatArgs({ prompt: fullPrompt, servers, mcpFile: config?.file, permission: CLAUDE_CHAT_PERMISSION, sessionId, model, effort });
      const result = await execa(binPath, args, {
        timeout: tools.timeLimitSeconds * 1000,
        env: { ...process.env, CLAUDE_CODE_SAFE_MODE: '1' },
        ...(config ? { cwd: chatFolder(sessionId) } : {}),
      });
      const stream = config ? readChatStream('claude-cli', result.stdout) : null;
      if (stream && stream.reply === null) throw new Error(stream.error ?? 'Claude Code gave no answer');
      const assistantText = (stream ? stream.reply ?? '' : result.stdout).trim();
      const used = stream ? countTools(stream.tools) : [];
      const suggestedSpec = this.extractSpecFromContent(assistantText);
      const cleanContent = this.stripSpecJsonFromContent(assistantText) || assistantText;
      return {
        message: {
          id: `msg-${Date.now()}`,
          role: 'assistant',
          content: cleanContent,
          timestamp: new Date().toISOString(),
          suggested_spec: suggestedSpec,
          ...(used.length ? { tools_used: used } : {}),
        },
        suggested_spec: suggestedSpec,
        provider_used: `Local Claude Code CLI (${model}) [effort: ${effort}]`,
      };
    } finally {
      config?.cleanup();
    }
  }
```

Replace `chatWithAgyCli` with:

```ts
  private async chatWithAgyCli(
    req: AiChatRequest,
    systemPrompt: string,
    binPath: string,
    cliSettings: any,
    sessionId: string | undefined,
    tools: AiChatToolsSettings
  ): Promise<AiChatResponse> {
    const model = req.model || cliSettings?.agy?.model || 'gemini-2.5-pro';
    const effort = req.effort || cliSettings?.agy?.effort || 'medium';
    const fullPrompt = `${systemPrompt}\n\n## Conversation History:\n${this.formatTranscript(req.messages)}\n\nArchitect:`;
    const result = await execa(binPath, agyChatArgs({ prompt: fullPrompt, mode: AGY_CHAT_MCP_MODE, sessionId, model, effort }), {
      timeout: tools.timeLimitSeconds * 1000,
      cwd: chatFolder(sessionId),
    });
    const stream = readChatStream('agy-cli', result.stdout);
    if (stream.reply === null) throw new Error(stream.error ?? 'AGY gave no answer');
    const assistantText = stream.reply.trim();
    const used = countTools(stream.tools);
    const suggestedSpec = this.extractSpecFromContent(assistantText);
    const cleanContent = this.stripSpecJsonFromContent(assistantText) || assistantText;
    return {
      message: {
        id: `msg-${Date.now()}`,
        role: 'assistant',
        content: cleanContent,
        timestamp: new Date().toISOString(),
        suggested_spec: suggestedSpec,
        ...(used.length ? { tools_used: used } : {}),
      },
      suggested_spec: suggestedSpec,
      provider_used: `Local Antigravity CLI (${model}) [effort: ${effort}]`,
    };
  }
```

In `sendSessionMessage`, step 6 (record the assistant message) becomes:

```ts
    const assistantMsgId = `msg-${crypto.randomUUID()}`;
    const specJson = response.suggested_spec ? JSON.stringify(response.suggested_spec) : null;
    const toolsUsed = response.message.tools_used?.length ? response.message.tools_used : undefined;

    this.db
      .prepare(
        `INSERT INTO ai_chat_messages (id, session_id, role, content, spec_json, attachments, tools_used, created_at)
         VALUES (?, ?, 'assistant', ?, ?, '[]', ?, ?)`
      )
      .run(assistantMsgId, sessionId, response.message.content, specJson, toolsUsed ? JSON.stringify(toolsUsed) : null, now);
```

and its returned `message` gains `...(toolsUsed ? { tools_used: toolsUsed } : {}),` after `suggested_spec: response.suggested_spec,`.

In `getSession`, inside `messageRows.map`, before `return {`:

```ts
      let toolsUsed: AiChatMessage['tools_used'];
      if (m.tools_used) {
        try {
          toolsUsed = JSON.parse(m.tools_used);
        } catch {}
      }
```

and add `...(toolsUsed?.length ? { tools_used: toolsUsed } : {}),` as the last field of the returned message object.

The heuristic provider has no model, so skills cannot apply to it (the spec lists it with Ollama); record that as a ruling.

- [ ] **Step 9: Run the chat tests**

Run: `npx vitest run packages/server/src/aiChat packages/server/src/services/aiChatService.test.ts && npx tsc --noEmit -p packages/server`
Expected: PASS, no type errors.

- [ ] **Step 10: Commit**

```bash
git add packages/server/src/aiChat/chatTools.ts packages/server/src/aiChat/chatTools.test.ts packages/server/src/aiChat/chatTurn.test.ts packages/server/src/testing/fakeChatCli.mjs packages/server/src/services/aiChatService.ts
git commit -m "feat(server): AI Chat passes Settings MCP servers and skills to Claude Code and AGY"
```

---

### Task 9: Settings → AI Chat tab

**Files:**
- Create: `packages/web/src/lib/aiChatToolsApi.ts`, `packages/web/src/lib/aiChatTools.ts`, `packages/web/src/components/AiChatToolsSettingsSection.tsx`
- Modify: `packages/web/src/components/RichCommentEditor.tsx` (`allowFiles` prop), `packages/web/src/pages/SettingsPage.tsx` (tab)
- Test: `packages/web/src/lib/aiChatTools.test.ts`

**Interfaces:**
- Consumes: the API of Task 6; shared `AI_CHAT_SERVER_NAME`, `AI_CHAT_SKILL_NAME`, `AI_CHAT_RESERVED_SKILLS`, types (Task 2).
- Produces (web): `fetchAiChatTools`, `saveAiChatTools`, `testAiChatServer`, `importMcpJson`, `importSkillsFolder`, `reimportSkill`, `syncAgyList`; helpers `type ViewServer`, `toUpdate(view)`, `serverBadge(server)`, `serverSummary(server)`, `serverProblem(server, taken)`, `skillProblem(name, taken)`, `secretRows(values)`, `secretsFromRows(rows)`, `type SecretRow`, `importSummary(result)`, `toolsUsedText(tools)`, `skillSlashCommands(skills)`.

- [ ] **Step 1: Write the failing test** (`packages/web/src/lib/aiChatTools.test.ts`)

```ts
import { describe, it, expect } from 'vitest';
import type { AiChatToolsView } from '@sp-kickstack/shared';
import {
  importSummary, secretRows, secretsFromRows, serverBadge, serverProblem, serverSummary, skillProblem, skillSlashCommands, toUpdate, toolsUsedText,
} from './aiChatTools';

const view: AiChatToolsView = {
  timeLimitSeconds: 120,
  servers: [{ name: 'jira', enabled: true, transport: 'stdio', command: 'npx', args: ['-y', 'jira-mcp'], env: { TOKEN: { set: true } }, headers: {}, status: { ok: true, tools: 12, checkedAt: 'T' } }],
  skills: [
    { name: 'api-contract', description: 'When writing an API', body: 'x', mode: 'on_request', enabled: true },
    { name: 'house', description: '', body: 'y', mode: 'always', enabled: true },
    { name: 'off', description: '', body: 'z', mode: 'on_request', enabled: false },
  ],
  agy: { detected: false, usesMcp: true, servers: [] },
};

describe('AI Chat tools helpers', () => {
  it('shows a server as a badge and a one-line summary', () => {
    expect(serverBadge(view.servers[0])).toEqual({ tone: 'ok', text: 'Connected · 12 tools' });
    expect(serverBadge({ ...view.servers[0], status: { ok: false, tools: 0, error: 'spawn npx ENOENT', checkedAt: 'T' } })).toEqual({ tone: 'error', text: 'Failed: spawn npx ENOENT' });
    expect(serverBadge({ ...view.servers[0], status: undefined })).toEqual({ tone: 'idle', text: 'Not tested' });
    expect(serverSummary(view.servers[0])).toBe('npx -y jira-mcp');
    expect(serverSummary({ ...view.servers[0], transport: 'http', url: 'https://f/mcp' })).toBe('https://f/mcp');
  });

  it('checks a server and a skill before saving', () => {
    expect(serverProblem({ name: 'my server', transport: 'stdio', command: 'x' }, [])).toBe('Server names use letters, digits, - and _ (up to 40)');
    expect(serverProblem({ name: 'jira', transport: 'stdio', command: 'x' }, ['jira'])).toBe('A server named jira already exists');
    expect(serverProblem({ name: 'a', transport: 'stdio', command: ' ' }, [])).toBe('A stdio server needs a command');
    expect(serverProblem({ name: 'a', transport: 'http', url: 'mcp.figma.com' }, [])).toBe('An http server needs a URL starting with http:// or https://');
    expect(serverProblem({ name: 'a', transport: 'http', url: 'https://x' }, [])).toBeNull();
    expect(skillProblem('API', [])).toBe('Skill names use lowercase letters, digits and - (up to 40)');
    expect(skillProblem('create', [])).toBe('/create is a chat command; choose another name');
    expect(skillProblem('house', ['house'])).toBe('A skill named house already exists');
  });

  it('turns secrets into editable rows and back, keeping untouched ones as { set: true }', () => {
    const rows = secretRows({ TOKEN: { set: true }, SITE: 'acme' });
    expect(rows).toEqual([{ key: 'TOKEN', value: '', kept: true }, { key: 'SITE', value: 'acme', kept: false }]);
    expect(secretsFromRows([...rows, { key: '', value: 'x', kept: false }])).toEqual({ TOKEN: { set: true }, SITE: 'acme' });
    expect(secretsFromRows([{ key: 'TOKEN', value: 'new', kept: false }])).toEqual({ TOKEN: 'new' });
  });

  it('builds the save body without test results', () => {
    expect(toUpdate(view)).toEqual({
      timeLimitSeconds: 120,
      servers: [{ name: 'jira', enabled: true, transport: 'stdio', command: 'npx', args: ['-y', 'jira-mcp'], env: { TOKEN: { set: true } }, url: undefined, headers: {} }],
      skills: view.skills,
    });
  });

  it('words imports, tools used and /skill commands', () => {
    expect(importSummary({ added: ['figma', 'fs'], skipped: [{ name: 'jira', reason: 'already exists' }] })).toBe('Added figma, fs. Skipped jira (already exists).');
    expect(importSummary({ added: [], skipped: [] })).toBe('Nothing to add.');
    expect(toolsUsedText([{ tool: 'jira.search_issues', count: 2 }, { tool: 'figma.get_frame', count: 1 }])).toBe('jira.search_issues ×2, figma.get_frame');
    expect(toolsUsedText(undefined)).toBeNull();
    expect(skillSlashCommands(view.skills)).toEqual([{ id: 'skill-api-contract', command: '/api-contract', title: 'api-contract', description: 'When writing an API' }]);
  });
});
```

- [ ] **Step 2: Run it to see it fail**

Run: `npx vitest run packages/web/src/lib/aiChatTools.test.ts`
Expected: FAIL ("Failed to load url ./aiChatTools").

- [ ] **Step 3: Write `aiChatTools.ts`**

```ts
import { AI_CHAT_RESERVED_SKILLS, AI_CHAT_SERVER_NAME, AI_CHAT_SKILL_NAME } from '@sp-kickstack/shared';
import type { AiChatImportResult, AiChatSecret, AiChatSkill, AiChatToolUse, AiChatToolsUpdateInput, AiChatToolsView } from '@sp-kickstack/shared';

export type ViewServer = AiChatToolsView['servers'][number];
export interface SecretRow {
  key: string;
  value: string;
  /** A stored secret left as it is (sent back as { set: true }). */
  kept: boolean;
}

export function serverBadge(server: ViewServer): { tone: 'ok' | 'error' | 'idle'; text: string } {
  if (!server.status) return { tone: 'idle', text: 'Not tested' };
  if (!server.status.ok) return { tone: 'error', text: `Failed: ${server.status.error ?? 'unknown error'}` };
  return { tone: 'ok', text: `Connected · ${server.status.tools} ${server.status.tools === 1 ? 'tool' : 'tools'}` };
}

export function serverSummary(server: ViewServer): string {
  return server.transport === 'http' ? server.url ?? '' : [server.command, ...server.args].filter(Boolean).join(' ');
}

export function serverProblem(server: { name: string; transport: 'stdio' | 'http'; command?: string; url?: string }, taken: string[]): string | null {
  if (!AI_CHAT_SERVER_NAME.test(server.name)) return 'Server names use letters, digits, - and _ (up to 40)';
  if (taken.includes(server.name)) return `A server named ${server.name} already exists`;
  if (server.transport === 'stdio' && !server.command?.trim()) return 'A stdio server needs a command';
  if (server.transport === 'http' && !/^https?:\/\/\S+$/.test(server.url?.trim() ?? '')) return 'An http server needs a URL starting with http:// or https://';
  return null;
}

export function skillProblem(name: string, taken: string[]): string | null {
  if (!AI_CHAT_SKILL_NAME.test(name)) return 'Skill names use lowercase letters, digits and - (up to 40)';
  if (AI_CHAT_RESERVED_SKILLS.includes(name)) return '/create is a chat command; choose another name';
  if (taken.includes(name)) return `A skill named ${name} already exists`;
  return null;
}

export function secretRows(values: Record<string, AiChatSecret>): SecretRow[] {
  return Object.entries(values).map(([key, value]) => (typeof value === 'string' ? { key, value, kept: false } : { key, value: '', kept: true }));
}

export function secretsFromRows(rows: SecretRow[]): Record<string, AiChatSecret> {
  return Object.fromEntries(
    rows
      .filter((row) => row.key.trim())
      .map((row): [string, AiChatSecret] => [row.key.trim(), row.kept && row.value === '' ? { set: true } : row.value])
  );
}

export function toUpdate(view: AiChatToolsView): AiChatToolsUpdateInput {
  return {
    timeLimitSeconds: view.timeLimitSeconds,
    servers: view.servers.map((s) => ({
      name: s.name, enabled: s.enabled, transport: s.transport, command: s.command, args: s.args, env: s.env, url: s.url, headers: s.headers,
    })),
    skills: view.skills,
  };
}

export function importSummary(result: AiChatImportResult): string {
  const added = result.added.length ? `Added ${result.added.join(', ')}.` : '';
  const skipped = result.skipped.length ? `Skipped ${result.skipped.map((s) => `${s.name} (${s.reason})`).join(', ')}.` : '';
  return [added, skipped].filter(Boolean).join(' ') || 'Nothing to add.';
}

export function toolsUsedText(tools: AiChatToolUse[] | undefined): string | null {
  if (!tools?.length) return null;
  return tools.map((t) => (t.count > 1 ? `${t.tool} ×${t.count}` : t.tool)).join(', ');
}

/** On request skills for the chat's "/" menu. */
export function skillSlashCommands(skills: AiChatSkill[]): Array<{ id: string; command: string; title: string; description: string }> {
  return skills
    .filter((s) => s.enabled && s.mode === 'on_request')
    .map((s) => ({ id: `skill-${s.name}`, command: `/${s.name}`, title: s.name, description: s.description || 'Skill' }));
}
```

- [ ] **Step 4: Run the helper test**

Run: `npx vitest run packages/web/src/lib/aiChatTools.test.ts`
Expected: PASS.

- [ ] **Step 5: Write `aiChatToolsApi.ts`**

```ts
import type { AiChatAgySync, AiChatImportResult, AiChatServerStatus, AiChatSkill, AiChatToolsUpdateInput, AiChatToolsView } from '@sp-kickstack/shared';
import { BASE } from './api.js';

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, init);
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((body as { error?: string })?.error || `Request failed (${res.status})`);
  return body as T;
}
const send = (method: string, body?: unknown): RequestInit => ({
  method,
  headers: { 'Content-Type': 'application/json' },
  body: body === undefined ? undefined : JSON.stringify(body),
});

export const fetchAiChatTools = () => request<AiChatToolsView>(`${BASE}/ai-chat/tools`);
export const saveAiChatTools = (input: AiChatToolsUpdateInput) => request<AiChatToolsView>(`${BASE}/ai-chat/tools`, send('PUT', input));
export const testAiChatServer = (name: string) => request<AiChatServerStatus>(`${BASE}/ai-chat/tools/servers/${encodeURIComponent(name)}/test`, send('POST'));
export const importMcpJson = (json: string) => request<AiChatImportResult>(`${BASE}/ai-chat/tools/import-mcp-json`, send('POST', { json }));
export const importSkillsFolder = (folder: string) => request<AiChatImportResult>(`${BASE}/ai-chat/tools/import-skills`, send('POST', { folder }));
export const reimportSkill = (name: string) => request<AiChatSkill>(`${BASE}/ai-chat/tools/skills/${encodeURIComponent(name)}/reimport`, send('POST'));
export const syncAgyList = () => request<AiChatAgySync>(`${BASE}/ai-chat/tools/agy-sync`, send('POST'));
```

- [ ] **Step 6: Let `RichCommentEditor` hide attachments**

In `RichCommentEditor.tsx`: make `files` and `onFilesChange` optional and add `allowFiles?: boolean` to the props interface:

```ts
  files?: PendingFile[];
  onFilesChange?: Dispatch<SetStateAction<PendingFile[]>>;
  /** false: no paperclip and no file chips (e.g. skill instructions). */
  allowFiles?: boolean;
```

Destructure with defaults: `files = [], onFilesChange = () => undefined, allowFiles = true`. Wrap the separator `<span className="w-px …" />` and the paperclip `<button>` in `{allowFiles && (<>…</>)}`, and the hidden `<input type="file" …>` and the chips block in `{allowFiles && …}`.

- [ ] **Step 7: Write the Settings section** (`packages/web/src/components/AiChatToolsSettingsSection.tsx`)

```tsx
import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { AlertTriangle, Pencil, Plug, Plus, RefreshCw, Sparkles, Trash2 } from 'lucide-react';
import type { AiChatSkill, AiChatToolsView } from '@sp-kickstack/shared';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from './ui/dialog.js';
import { RichCommentEditor } from './RichCommentEditor.js';
import {
  fetchAiChatTools, importMcpJson, importSkillsFolder, reimportSkill, saveAiChatTools, syncAgyList, testAiChatServer,
} from '../lib/aiChatToolsApi.js';
import {
  importSummary, secretRows, secretsFromRows, serverBadge, serverProblem, serverSummary, skillProblem, toUpdate,
  type SecretRow, type ViewServer,
} from '../lib/aiChatTools.js';

const box = 'bg-white dark:bg-[#242424] border border-slate-200 dark:border-[#2d2d2d] rounded-2xl p-5 space-y-3';
const field = 'w-full px-2.5 py-1.5 rounded-lg border border-slate-200 dark:border-[#333333] bg-slate-50 dark:bg-[#1a1a1a] text-xs';
const button =
  'inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border border-slate-200 dark:border-[#333333] text-xs font-semibold hover:bg-slate-50 dark:hover:bg-[#2c2c2c] disabled:opacity-50';
const primary = 'px-3 py-1.5 rounded-lg bg-[#7b68ee] text-white text-xs font-bold disabled:opacity-50';
const BADGE = {
  ok: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300',
  error: 'bg-rose-100 text-rose-700 dark:bg-rose-950/40 dark:text-rose-300',
  idle: 'bg-slate-100 text-slate-600 dark:bg-[#2c2c2c] dark:text-slate-300',
};

function Switch({ on, label, onChange }: { on: boolean; label: string; onChange: (on: boolean) => void }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-label={label}
      onClick={() => onChange(!on)}
      className={`relative h-5 w-9 shrink-0 rounded-full transition-colors ${on ? 'bg-[#7b68ee]' : 'bg-slate-300 dark:bg-[#3a3a3a]'}`}
    >
      <span className={`absolute top-0.5 h-4 w-4 rounded-full bg-white transition-all ${on ? 'left-[18px]' : 'left-0.5'}`} />
    </button>
  );
}

function SecretRows({ label, rows, keyHint, onChange }: { label: string; rows: SecretRow[]; keyHint: string; onChange: (rows: SecretRow[]) => void }) {
  const set = (i: number, patch: Partial<SecretRow>) => onChange(rows.map((r, j) => (j === i ? { ...r, ...patch } : r)));
  return (
    <div className="space-y-1">
      <div className="text-[11px] font-semibold text-slate-600 dark:text-slate-300">{label}</div>
      {rows.map((row, i) => (
        <div key={i} className="flex gap-1.5">
          <input className={field} aria-label={`${label} name`} placeholder={keyHint} value={row.key} onChange={(e) => set(i, { key: e.target.value })} />
          <input
            className={field}
            type="password"
            aria-label={`${label} value`}
            placeholder={row.kept ? '•••• set (type to replace)' : 'value'}
            value={row.value}
            onChange={(e) => set(i, { value: e.target.value, kept: false })}
          />
          <button type="button" className={button} aria-label={`Remove ${row.key || 'row'}`} onClick={() => onChange(rows.filter((_, j) => j !== i))}>
            <Trash2 className="w-3 h-3" />
          </button>
        </div>
      ))}
      <button type="button" className={button} onClick={() => onChange([...rows, { key: '', value: '', kept: false }])}>
        <Plus className="w-3 h-3" />
        Add
      </button>
    </div>
  );
}

function ServerDialog({ server, taken, onSave, onClose }: { server?: ViewServer; taken: string[]; onSave: (s: ViewServer) => void; onClose: () => void }) {
  const [name, setName] = useState(server?.name ?? '');
  const [transport, setTransport] = useState<'stdio' | 'http'>(server?.transport ?? 'stdio');
  const [command, setCommand] = useState(server?.command ?? '');
  const [args, setArgs] = useState((server?.args ?? []).join('\n'));
  const [url, setUrl] = useState(server?.url ?? '');
  const [env, setEnv] = useState<SecretRow[]>(secretRows(server?.env ?? {}));
  const [headers, setHeaders] = useState<SecretRow[]>(secretRows(server?.headers ?? {}));
  const problem = serverProblem({ name, transport, command, url }, taken);
  const renamedWithKept = Boolean(server && name !== server.name && [...env, ...headers].some((r) => r.kept && !r.value));
  const save = () =>
    onSave({
      name,
      enabled: server?.enabled ?? true,
      transport,
      command: transport === 'stdio' ? command.trim() : undefined,
      args: transport === 'stdio' ? args.split('\n').map((a) => a.trim()).filter(Boolean) : [],
      env: transport === 'stdio' ? secretsFromRows(env) : {},
      url: transport === 'http' ? url.trim() : undefined,
      headers: transport === 'http' ? secretsFromRows(headers) : {},
    });
  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{server ? `Edit ${server.name}` : 'Add an MCP server'}</DialogTitle>
          <DialogDescription>AI Chat starts it for every message while it is on.</DialogDescription>
        </DialogHeader>
        <div className="space-y-3 text-xs">
          <input className={field} aria-label="Server name" placeholder="Name, e.g. jira" value={name} onChange={(e) => setName(e.target.value)} />
          <div role="radiogroup" aria-label="Type" className="flex gap-1.5">
            {(['stdio', 'http'] as const).map((t) => (
              <button key={t} type="button" role="radio" aria-checked={transport === t} onClick={() => setTransport(t)} className={transport === t ? primary : button}>
                {t === 'stdio' ? 'Command (stdio)' : 'URL (http)'}
              </button>
            ))}
          </div>
          {transport === 'stdio' ? (
            <>
              <input className={field} aria-label="Command" placeholder="Command, e.g. npx" value={command} onChange={(e) => setCommand(e.target.value)} />
              <textarea className={field} aria-label="Arguments" rows={3} placeholder={'Arguments, one per line, e.g.\n-y\n@atlassian/mcp-server'} value={args} onChange={(e) => setArgs(e.target.value)} />
              <SecretRows label="Environment variables" keyHint="e.g. JIRA_TOKEN" rows={env} onChange={setEnv} />
            </>
          ) : (
            <>
              <input className={field} aria-label="URL" placeholder="https://…/mcp" value={url} onChange={(e) => setUrl(e.target.value)} />
              <SecretRows label="Headers" keyHint="e.g. Authorization" rows={headers} onChange={setHeaders} />
            </>
          )}
          {renamedWithKept && <p className="text-amber-600">Renaming clears the stored secrets: type them again.</p>}
          {problem && <p className="text-rose-600">{problem}</p>}
        </div>
        <DialogFooter>
          <button type="button" className={button} onClick={onClose}>Cancel</button>
          <button type="button" className={primary} disabled={Boolean(problem)} onClick={save}>Save</button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function SkillDialog({ skill, taken, onSave, onClose }: { skill?: AiChatSkill; taken: string[]; onSave: (s: AiChatSkill) => void; onClose: () => void }) {
  const [name, setName] = useState(skill?.name ?? '');
  const [description, setDescription] = useState(skill?.description ?? '');
  const [mode, setMode] = useState<AiChatSkill['mode']>(skill?.mode ?? 'on_request');
  const [body, setBody] = useState(skill?.body ?? '');
  const problem = skillProblem(name, taken);
  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>{skill ? `Edit /${skill.name}` : 'New skill'}</DialogTitle>
          <DialogDescription>Instructions the AI follows when this skill applies.</DialogDescription>
        </DialogHeader>
        <div className="space-y-3 text-xs">
          <input className={field} aria-label="Skill name" placeholder="Name, e.g. api-contract" value={name} onChange={(e) => setName(e.target.value)} />
          <input className={field} aria-label="When to use" placeholder="When to use, e.g. when writing an API contract" value={description} onChange={(e) => setDescription(e.target.value)} />
          <div role="radiogroup" aria-label="When it applies" className="flex gap-1.5">
            {(['on_request', 'always'] as const).map((m) => (
              <button key={m} type="button" role="radio" aria-checked={mode === m} onClick={() => setMode(m)} className={mode === m ? primary : button}>
                {m === 'always' ? 'Always' : 'On request (/name)'}
              </button>
            ))}
          </div>
          <RichCommentEditor value={body} onChange={setBody} sources={{}} allowFiles={false} ariaLabel="Instructions" placeholder="What the AI should do (Markdown)" />
          {problem && <p className="text-rose-600">{problem}</p>}
        </div>
        <DialogFooter>
          <button type="button" className={button} onClick={onClose}>Cancel</button>
          <button
            type="button"
            className={primary}
            disabled={Boolean(problem)}
            onClick={() => onSave({ name, description: description.trim(), body, mode, enabled: skill?.enabled ?? true, ...(skill?.sourcePath ? { sourcePath: skill.sourcePath } : {}) })}
          >
            Save
          </button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function TextDialog({ title, description, label, placeholder, multiline, onSubmit, onClose }: {
  title: string; description: string; label: string; placeholder: string; multiline?: boolean; onSubmit: (text: string) => void; onClose: () => void;
}) {
  const [text, setText] = useState('');
  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        {multiline ? (
          <textarea className={`${field} font-mono`} rows={10} aria-label={label} placeholder={placeholder} value={text} onChange={(e) => setText(e.target.value)} />
        ) : (
          <input className={`${field} font-mono`} aria-label={label} placeholder={placeholder} value={text} onChange={(e) => setText(e.target.value)} />
        )}
        <DialogFooter>
          <button type="button" className={button} onClick={onClose}>Cancel</button>
          <button type="button" className={primary} disabled={!text.trim()} onClick={() => onSubmit(text)}>Import</button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** Settings → AI Chat: MCP servers and skills for every AI Chat message (one list for the system). */
export function AiChatToolsSettingsSection() {
  const queryClient = useQueryClient();
  const { data, error } = useQuery({ queryKey: ['ai-chat-tools'], queryFn: fetchAiChatTools });
  const [serverEdit, setServerEdit] = useState<{ server?: ViewServer } | null>(null);
  const [skillEdit, setSkillEdit] = useState<{ skill?: AiChatSkill } | null>(null);
  const [dialog, setDialog] = useState<'paste' | 'import' | null>(null);
  const [reimportAsk, setReimportAsk] = useState<AiChatSkill | null>(null);
  const [limit, setLimit] = useState<string | null>(null);
  const fail = (err: Error) => toast.error(err.message);
  const refresh = () => queryClient.invalidateQueries({ queryKey: ['ai-chat-tools'] });

  const save = useMutation({
    mutationFn: (view: AiChatToolsView) => saveAiChatTools(toUpdate(view)),
    onSuccess: (view) => {
      queryClient.setQueryData(['ai-chat-tools'], view);
      toast.success('AI Chat tools saved');
    },
    onError: fail,
  });
  const test = useMutation({ mutationFn: testAiChatServer, onSuccess: refresh, onError: fail });
  const agy = useMutation({
    mutationFn: syncAgyList,
    onSuccess: (r) => {
      refresh();
      if (r.ok) toast.success(r.message);
      else toast.error(r.message);
    },
    onError: fail,
  });
  const paste = useMutation({ mutationFn: importMcpJson, onSuccess: (r) => { refresh(); setDialog(null); toast.success(importSummary(r)); }, onError: fail });
  const importFolder = useMutation({ mutationFn: importSkillsFolder, onSuccess: (r) => { refresh(); setDialog(null); toast.success(importSummary(r)); }, onError: fail });
  const reimport = useMutation({ mutationFn: reimportSkill, onSuccess: () => { refresh(); setReimportAsk(null); toast.success('Skill re-imported'); }, onError: fail });

  if (error) return <p className="text-xs text-rose-600">{(error as Error).message}</p>;
  if (!data) return <p className="text-xs text-slate-500">Loading…</p>;
  const put = (patch: Partial<AiChatToolsView>) => save.mutate({ ...data, ...patch });
  const limitValue = limit ?? String(data.timeLimitSeconds);
  const limitOk = /^\d+$/.test(limitValue) && Number(limitValue) >= 5 && Number(limitValue) <= 1800;

  return (
    <div className="space-y-5">
      <div className={box}>
        <h2 className="text-sm font-bold flex items-center gap-2">
          <Plug className="w-4 h-4 text-[#7b68ee]" />
          MCP servers for AI Chat
        </h2>
        <p className="text-[11px] text-amber-700 dark:text-amber-300 flex items-start gap-1.5">
          <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
          The AI can use any tool of an enabled server without asking. Only enable servers you are happy for it to use.
        </p>
        <div className="divide-y divide-slate-100 dark:divide-[#2d2d2d]">
          {data.servers.length === 0 && <p className="py-3 text-xs text-slate-500">No servers yet. Add one or paste a .mcp.json.</p>}
          {data.servers.map((s) => {
            const badge = serverBadge(s);
            return (
              <div key={s.name} className="py-2.5 flex items-center gap-3 flex-wrap">
                <Switch on={s.enabled} label={`Use ${s.name}`} onChange={(on) => put({ servers: data.servers.map((x) => (x.name === s.name ? { ...x, enabled: on } : x)) })} />
                <div className="min-w-0 flex-1">
                  <div className="text-xs font-bold font-mono">
                    {s.name} <span className="font-normal text-slate-400">{s.transport}</span>
                  </div>
                  <div className="text-[11px] text-slate-500 font-mono truncate">{serverSummary(s)}</div>
                </div>
                <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${BADGE[badge.tone]}`}>{badge.text}</span>
                <button type="button" className={button} disabled={test.isPending} onClick={() => test.mutate(s.name)}>
                  {test.isPending && test.variables === s.name ? 'Testing…' : 'Test'}
                </button>
                <button type="button" className={button} aria-label={`Edit ${s.name}`} onClick={() => setServerEdit({ server: s })}>
                  <Pencil className="w-3 h-3" />
                </button>
                <button type="button" className={button} aria-label={`Delete ${s.name}`} onClick={() => put({ servers: data.servers.filter((x) => x.name !== s.name) })}>
                  <Trash2 className="w-3 h-3" />
                </button>
              </div>
            );
          })}
        </div>
        <div className="flex gap-2">
          <button type="button" className={button} onClick={() => setServerEdit({})}>
            <Plus className="w-3 h-3" />
            Add server
          </button>
          <button type="button" className={button} onClick={() => setDialog('paste')}>Paste .mcp.json</button>
        </div>
      </div>

      <div className={box}>
        <h2 className="text-sm font-bold">AGY</h2>
        {!data.agy.detected ? (
          <p className="text-xs text-slate-500">AGY not detected.</p>
        ) : (
          <>
            <p className="text-[11px] text-slate-500">
              {data.agy.usesMcp
                ? "Enabled servers above are added to AGY's list as sp-<name>. AGY uses its list in your own sessions too, and keeps their secrets in its own config (~/.gemini/config/mcp_config.json)."
                : 'AGY chats do not use MCP tools on this PC; nothing is added to its list.'}
            </p>
            {data.agy.error && <p className="text-[11px] text-rose-600">{data.agy.error}</p>}
            <div className="overflow-x-auto">
              <table className="w-full text-[11px]">
                <tbody>
                  {data.agy.servers.map((s) => (
                    <tr key={s.name} className="border-t border-slate-100 dark:border-[#2d2d2d]">
                      <td className="py-1 pr-3 font-mono font-semibold">{s.name}</td>
                      <td className="py-1 pr-3">{s.type}</td>
                      <td className="py-1 pr-3">{s.status}</td>
                      <td className="py-1 font-mono text-slate-500 truncate max-w-[16rem]">{s.target}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="flex items-center gap-2 flex-wrap">
              <button type="button" className={button} disabled={agy.isPending} onClick={() => agy.mutate()}>
                <RefreshCw className="w-3 h-3" />
                Update AGY's list
              </button>
              {data.agySync && (
                <span className={`text-[11px] ${data.agySync.ok ? 'text-slate-500' : 'text-rose-600'}`}>
                  {data.agySync.message} · {new Date(data.agySync.at).toLocaleString()}
                </span>
              )}
            </div>
          </>
        )}
      </div>

      <div className={box}>
        <h2 className="text-sm font-bold flex items-center gap-2">
          <Sparkles className="w-4 h-4 text-[#7b68ee]" />
          Skills
        </h2>
        <p className="text-[11px] text-slate-500">Always: added to every chat message. On request: type /name in the chat.</p>
        <div className="divide-y divide-slate-100 dark:divide-[#2d2d2d]">
          {data.skills.length === 0 && <p className="py-3 text-xs text-slate-500">No skills yet. Write one or import a folder of SKILL.md files.</p>}
          {data.skills.map((k) => (
            <div key={k.name} className="py-2.5 flex items-center gap-3 flex-wrap">
              <Switch on={k.enabled} label={`Use skill ${k.name}`} onChange={(on) => put({ skills: data.skills.map((x) => (x.name === k.name ? { ...x, enabled: on } : x)) })} />
              <div className="min-w-0 flex-1">
                <div className="text-xs font-bold font-mono">/{k.name}</div>
                <div className="text-[11px] text-slate-500 truncate">
                  {k.description || 'No "when to use" yet'}
                  {k.sourcePath ? ` · from ${k.sourcePath}` : ''}
                </div>
              </div>
              <div role="radiogroup" aria-label={`When ${k.name} applies`} className="flex gap-1">
                {(['always', 'on_request'] as const).map((m) => (
                  <button
                    key={m}
                    type="button"
                    role="radio"
                    aria-checked={k.mode === m}
                    onClick={() => put({ skills: data.skills.map((x) => (x.name === k.name ? { ...x, mode: m } : x)) })}
                    className={k.mode === m ? primary : button}
                  >
                    {m === 'always' ? 'Always' : 'On request'}
                  </button>
                ))}
              </div>
              {k.sourcePath && (
                <button type="button" className={button} onClick={() => setReimportAsk(k)}>Re-import</button>
              )}
              <button type="button" className={button} aria-label={`Edit ${k.name}`} onClick={() => setSkillEdit({ skill: k })}>
                <Pencil className="w-3 h-3" />
              </button>
              <button type="button" className={button} aria-label={`Delete ${k.name}`} onClick={() => put({ skills: data.skills.filter((x) => x.name !== k.name) })}>
                <Trash2 className="w-3 h-3" />
              </button>
            </div>
          ))}
        </div>
        <div className="flex gap-2">
          <button type="button" className={button} onClick={() => setSkillEdit({})}>
            <Plus className="w-3 h-3" />
            New skill
          </button>
          <button type="button" className={button} onClick={() => setDialog('import')}>Import folder</button>
        </div>
      </div>

      <div className={box}>
        <h2 className="text-sm font-bold">Chat time limit</h2>
        <div className="flex items-center gap-2 text-xs">
          <input type="number" min={5} max={1800} aria-label="Seconds per chat message" className={`${field} w-28`} value={limitValue} onChange={(e) => setLimit(e.target.value)} />
          <span>seconds per chat message</span>
          <button
            type="button"
            className={primary}
            disabled={!limitOk || limit === null}
            onClick={() => {
              put({ timeLimitSeconds: Number(limitValue) });
              setLimit(null);
            }}
          >
            Save
          </button>
        </div>
      </div>

      {serverEdit && (
        <ServerDialog
          server={serverEdit.server}
          taken={data.servers.map((s) => s.name).filter((n) => n !== serverEdit.server?.name)}
          onClose={() => setServerEdit(null)}
          onSave={(next) => {
            const servers = serverEdit.server ? data.servers.map((s) => (s.name === serverEdit.server!.name ? next : s)) : [...data.servers, next];
            put({ servers });
            setServerEdit(null);
          }}
        />
      )}
      {skillEdit && (
        <SkillDialog
          skill={skillEdit.skill}
          taken={data.skills.map((s) => s.name).filter((n) => n !== skillEdit.skill?.name)}
          onClose={() => setSkillEdit(null)}
          onSave={(next) => {
            const skills = skillEdit.skill ? data.skills.map((s) => (s.name === skillEdit.skill!.name ? next : s)) : [...data.skills, next];
            put({ skills });
            setSkillEdit(null);
          }}
        />
      )}
      {dialog === 'paste' && (
        <TextDialog
          title="Paste .mcp.json"
          description='Servers of a Claude-format file ({ "mcpServers": { … } }) are added; names that exist are skipped.'
          label=".mcp.json"
          placeholder='{ "mcpServers": { "jira": { "command": "npx", "args": ["-y", "…"] } } }'
          multiline
          onClose={() => setDialog(null)}
          onSubmit={(text) => paste.mutate(text)}
        />
      )}
      {dialog === 'import' && (
        <TextDialog
          title="Import skills"
          description="Every SKILL.md below this folder becomes an editable copy."
          label="Folder"
          placeholder="~/.claude/skills"
          onClose={() => setDialog(null)}
          onSubmit={(folder) => importFolder.mutate(folder)}
        />
      )}
      {reimportAsk && (
        <Dialog open onOpenChange={(open) => !open && setReimportAsk(null)}>
          <DialogContent className="max-w-md">
            <DialogHeader>
              <DialogTitle>Re-import /{reimportAsk.name}?</DialogTitle>
              <DialogDescription>Its text is replaced by {reimportAsk.sourcePath}; edits made here are lost.</DialogDescription>
            </DialogHeader>
            <DialogFooter>
              <button type="button" className={button} onClick={() => setReimportAsk(null)}>Cancel</button>
              <button type="button" className={primary} disabled={reimport.isPending} onClick={() => reimport.mutate(reimportAsk.name)}>Re-import</button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}
    </div>
  );
}
```

- [ ] **Step 8: Add the tab to `SettingsPage.tsx`**

- Add `Plug,` to the `lucide-react` import list.
- Add `import { AiChatToolsSettingsSection } from '../components/AiChatToolsSettingsSection.js';` next to the other section imports.
- `export type SettingsTab = 'ai' | 'ai-chat' | 'workspaces' | 'git' | 'ide' | 'appearance' | 'safety' | 'notifications';` and add `'ai-chat'` to `VALID_TABS` after `'ai'`.
- In the `tabs` array, after the `ai` entry: `{ id: 'ai-chat', label: 'AI Chat', sublabel: 'MCP servers & skills', icon: Plug },`
- Before `{activeTab === 'workspaces' && (`: `{activeTab === 'ai-chat' && <AiChatToolsSettingsSection />}`

- [ ] **Step 9: Typecheck, build and test the web**

Run: `npx tsc --noEmit -p packages/web && (cd packages/web && npx vite build) && npx vitest run packages/web`
Expected: no type errors, build OK, all web tests pass.

- [ ] **Step 10: Commit**

```bash
git add packages/web/src/lib/aiChatToolsApi.ts packages/web/src/lib/aiChatTools.ts packages/web/src/lib/aiChatTools.test.ts packages/web/src/components/AiChatToolsSettingsSection.tsx packages/web/src/components/RichCommentEditor.tsx packages/web/src/pages/SettingsPage.tsx
git commit -m "feat(web): Settings → AI Chat tab: MCP servers, AGY list, skills, time limit"
```

---

### Task 10: `/skill` in the chat and "Tools used" under replies

**Files:**
- Modify: `packages/web/src/pages/AiChatPage.tsx` (`availableCommands` useMemo near line 271; assistant message body near line 1509)
- Modify: `packages/web/src/components/BrowserAiSidebar.tsx` (after `<MarkdownMessage content={msg.content} />` near line 1362)

**Interfaces:**
- Consumes: `fetchAiChatTools` (Task 9), `skillSlashCommands`, `toolsUsedText` (Task 9), `AiChatMessage.tools_used` (Task 2).

- [ ] **Step 1: `/skill` commands** (`AiChatPage.tsx`)

Add imports:

```ts
import { fetchAiChatTools } from '../lib/aiChatToolsApi.js';
import { skillSlashCommands, toolsUsedText } from '../lib/aiChatTools.js';
```

Next to the other queries:

```ts
  const { data: chatTools } = useQuery({ queryKey: ['ai-chat-tools'], queryFn: fetchAiChatTools, staleTime: 30_000 });
```

In the `availableCommands` useMemo, build the list as `[...commands, ...skillSlashCommands(chatTools?.skills ?? [])]` before filtering by `hashSlashQuery` (replace `const commands = [ … ];` with `const commands = [ …existing /create entry…, ...skillSlashCommands(chatTools?.skills ?? []) ];`) and add `chatTools` to its dependency array. `selectCommand` already inserts `${cmd.command} ` into the message.

- [ ] **Step 2: "Tools used" line** (`AiChatPage.tsx`, right after the assistant `<MarkdownMessage … />`)

```tsx
                          {toolsUsedText(msg.tools_used) && (
                            <div className="mt-1.5 text-[10px] text-slate-500 dark:text-slate-400">🔧 Tools used: {toolsUsedText(msg.tools_used)}</div>
                          )}
```

and in `BrowserAiSidebar.tsx` (its messages use a local `interface Message`):
- add `tools_used?: AiChatToolUse[];` to `interface Message` (import the type from `@sp-kickstack/shared`) and `import { toolsUsedText } from '../lib/aiChatTools.js';`;
- where it builds the reply (`const assistantMsg: Message = { … content: res.message?.content || 'Done.', … }`), add `tools_used: res.message?.tools_used,`;
- where it loads a session (`fullSession.messages.map((m) => ({ … attachments: m.attachments, }))`), add `tools_used: m.tools_used,`;
- after `<MarkdownMessage content={msg.content} />`:

```tsx
              {msg.role === 'assistant' && toolsUsedText(msg.tools_used) && (
                <div className="mt-1.5 text-[10px] text-slate-500 dark:text-slate-400">🔧 Tools used: {toolsUsedText(msg.tools_used)}</div>
              )}
```

- [ ] **Step 3: Typecheck, build and test the web**

Run: `npx tsc --noEmit -p packages/web && (cd packages/web && npx vite build) && npx vitest run packages/web`
Expected: no type errors, build OK, tests pass.

- [ ] **Step 4: Commit**

```bash
git add packages/web/src/pages/AiChatPage.tsx packages/web/src/components/BrowserAiSidebar.tsx
git commit -m "feat(web): /skill commands in AI Chat and a Tools used line under replies"
```

---

### Task 11: Docs, desktop bundle, dev server, full check

**Files:**
- Modify: `docs/guide/09-settings-and-environment.md`, `docs/guide/10-troubleshooting.md`
- Modify (generated): `packages/desktop/src-tauri/resources/server/index.mjs`, `xticket.mjs`

- [ ] **Step 1: Guide 09** — in the "Settings tabs" table, after the **AI & Local Engines** row:

```markdown
| **AI Chat** | MCP servers and skills for the AI chats (AI Chat page and the browser sidebar), one list for the whole system, and the chat time limit. See [AI Chat: MCP servers and skills](#ai-chat-mcp-servers-and-skills). |
```

and add this section after "### Git & Branch Rules":

```markdown
### AI Chat: MCP servers and skills

Every AI Chat message can use the MCP servers and skills listed here.

- **MCP servers**: **Add server** (a command such as `npx -y @atlassian/mcp-server`, or an `http` URL), or
  **Paste .mcp.json** (Claude's `{ "mcpServers": { … } }` format; names that exist are skipped). Environment
  variables and headers are secrets: once saved they show as `•••• set` and are never shown again; type a
  new value to replace one. **Test** starts the server and shows `Connected · N tools` or `Failed: <reason>`.
  The AI can use any tool of an enabled server without asking: only enable servers you are happy for it to use.
- **Claude Code** gets only the enabled servers listed here (not the ones in your own `~/.claude`), for one
  message at a time.
- **AGY** has one MCP list of its own. Enabled servers are added to it as `sp-<name>` (and removed when you
  turn them off), so your own AGY sessions see them too, and AGY keeps their secrets in
  `~/.gemini/config/mcp_config.json`. Your other AGY servers are never changed. **Update AGY's list** runs this
  again.
- **Skills**: **New skill** (name, when to use, instructions) or **Import folder** (every `SKILL.md` below
  it, e.g. `~/.claude/skills`, becomes an editable copy; **Re-import** reads the file again). **Always** skills
  are added to every chat message; **On request** skills are picked by typing `/name` in the chat.
- **Chat time limit**: how long one chat message may take (default 120 s).

A reply that used tools shows `🔧 Tools used: jira.search_issues ×2, …` under it.
```

- [ ] **Step 2: Guide 10** — add these rows to the table that lists messages (next to the AI rows):

```markdown
| `Failed: <reason>` (Settings → AI Chat) | The MCP server did not start or answer. | Check the command or URL and the secrets; run the command in a terminal to see its error. |
| `The AI did not answer within N s` | A chat message took longer than the chat time limit. | Try again, or raise **Chat time limit** in Settings → AI Chat. |
| `No SKILL.md found under <folder>` | Import found no skill files. | Pick the folder that contains the skill folders (e.g. `~/.claude/skills`). |
| `Not a .mcp.json file: <reason>` | The pasted text is not JSON in Claude's `.mcp.json` format. | Paste the whole file. |
| `AGY not detected` | AGY is not installed or not found. | Install AGY or set its path in Settings → AI & Local Engines. |
```

- [ ] **Step 3: Full verification**

Run: `npx tsc --noEmit -p packages/server && npx tsc --noEmit -p packages/web && (cd packages/web && npx vite build) && npx vitest run`
Expected: everything passes (the `aiDraft` "lists provider status" test calls real CLIs and can time out; record it if it does).

- [ ] **Step 4: Regenerate the desktop bundle** (Rule A)

Run: `npm run desktop:bundle-server`
Expected: "✅ Server JavaScript bundle created" and "✅ xticket CLI bundle created". In the shared checkout, build it from HEAD in a clean worktree so other uncommitted work is not bundled.

- [ ] **Step 5: Rebuild the shared package for the running dev server and check it**

Run: `(cd packages/shared && npx tsc -p .) && sleep 8 && curl -s -o /dev/null -w "%{http_code}\n" localhost:4100/api/health`
Expected: `200`.

- [ ] **Step 6: Commit**

```bash
git add docs/guide/09-settings-and-environment.md docs/guide/10-troubleshooting.md packages/desktop/src-tauri/resources/server/index.mjs packages/desktop/src-tauri/resources/server/xticket.mjs
git commit -m "docs: AI Chat MCP servers and skills; build(desktop): regenerate server bundle"
```
