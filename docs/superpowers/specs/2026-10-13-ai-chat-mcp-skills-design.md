# AI Chat MCP servers and skills — design

Status: design approved by the user in chat, 2026-10-13 ("Simple config"; replaces the earlier gateway
draft `2026-10-13-ai-assistant-tools-design.md`, which the user found was not what they meant). Builds on
AI Chat (`AiChatService`), the browser AI sidebar (2026-10-13) and the Local AI CLI engine's helpers
(`localEngine/cliProfiles.ts`, `localEngine/outputParsers.ts`).

## Problem

The AI Chat cannot use MCP servers or skills, and there is no place in the system to set them up.

- Chats run Claude Code with `--tools ""` and AGY in plain print mode: no MCP tool can be called.
- Skills (reusable instructions such as "write an API contract") cannot be given to the chat.
- Each chat turn has a fixed 35 s limit, too short once tools are used.

## Decisions (user, 2026-10-13)

- **Simple config:** Settings gets a place to add MCP servers and skills; every AI Chat message passes them
  to the CLI. No bridge-built tools, no gateway, no confirm step.
- **One list for the whole system** (not per workspace).
- **Only what is in Settings** for Claude Code (`--strict-mcp-config`). AGY has no strict mode and always
  loads its own list; the bridge adds the Settings servers to it.
- **CLIs:** Claude Code and AGY, equally.
- **Skills:** written in Settings and imported from `SKILL.md` folders.
- **Surfaces:** the chats (AI Chat page and browser AI sidebar, both through `AiChatService.chat`).

## What the person sees

**Settings → AI Chat** (new tab, `?tab=ai-chat`, Rule F):

- **MCP servers**
  - List: name, type, command or URL, on/off, status badge (`Connected · 12 tools`, `Failed: <reason>`,
    `Not tested`) and **Test**.
  - **Add / Edit**: name (letters, digits, `-` `_`); `stdio` (command, arguments, environment variables)
    or `http` (URL, headers). **Delete**.
  - **Paste .mcp.json**: adds the servers of a Claude-format file (`{ "mcpServers": { … } }`); a name that
    already exists is skipped and listed.
  - Secrets (environment variable values, header values) are write-only: shown as `•••• set`, replaced by
    typing a new value.
  - Warning above the list: "The AI can use any tool of an enabled server without asking. Only enable
    servers you are happy for it to use."
- **AGY**: AGY's own MCP list (from `agy mcp list`, read-only) and the note "Enabled servers above are added
  to AGY's list as `sp-<name>`; AGY uses its list in your own sessions too." Shows the last sync result.
- **Skills**
  - List: name, *when to use*, mode **Always** / **On request**, on/off.
  - **New skill**: name (slug), *when to use*, instructions (the Markdown editor used by review comments).
  - **Import**: a folder path (e.g. `~/.claude/skills` or a repository's `.claude/skills`); every
    `SKILL.md` below it becomes an editable copy (name from its front matter `name`, else the folder name;
    *when to use* from `description`). A name that already exists is skipped and listed. An imported skill
    shows its source path and has **Re-import** (overwrites after a confirmation).
- **Chat time limit**: seconds per chat message, default 120.

**In a chat:**

- `/` in the message box also lists **On request** skills; `/name` adds that skill to the message.
- Under a reply that used tools: `🔧 Tools used: jira.search_issues ×2, figma.get_frame`.

## Settings and data

- Settings key `ai_chat_tools` (`AiChatToolsSettingsSchema` in `packages/shared/src/schemas.ts`,
  `AiChatToolsSettings` in `types.ts`, saved by `SettingsService`, Rule B):

  ```ts
  {
    timeLimitSeconds: number;               // default 120
    servers: Array<{
      name: string;                         // unique
      enabled: boolean;
      transport: 'stdio' | 'http';
      command?: string; args?: string[];    // stdio
      env?: Record<string, string>;         // stdio, secret values
      url?: string;                         // http
      headers?: Record<string, string>;     // http, secret values
      status?: { ok: boolean; tools: number; error?: string; checkedAt: string };
    }>;
    skills: Array<{
      name: string;                         // slug, unique
      description: string;                  // when to use
      body: string;                         // instructions (Markdown)
      mode: 'always' | 'on_request';
      enabled: boolean;
      sourcePath?: string;                  // when imported
    }>;
  }
  ```

- **Endpoints** (never return secret values; secrets come back as `{ set: true }`):
  - `GET /api/ai-chat/tools`, `PUT /api/ai-chat/tools` (a secret sent as `{ set: true }` keeps its stored
    value);
  - `POST /api/ai-chat/tools/servers/:name/test`;
  - `POST /api/ai-chat/tools/import-mcp-json` (body: the pasted JSON);
  - `POST /api/ai-chat/tools/import-skills` (body: folder path), `POST …/skills/:name/reimport`;
  - `POST /api/ai-chat/tools/agy-sync` (also run after every save).
- **Migration 11** (the latest is 10): `ai_chat_messages.tools_used TEXT` (JSON: `[{ "tool": "jira.search_issues",
  "count": 2 }]`), shown under the reply.

## A chat message

`AiChatService.chat` chooses the provider as today, then:

**Claude Code**, when at least one server is enabled:

```
claude -p <prompt> --output-format stream-json --verbose --tools ""
       --mcp-config <temp file> --strict-mcp-config
       --allowedTools mcp__<server1> mcp__<server2> …
       [--model …] [--effort …]
```

- The temp file holds `{ "mcpServers": { … } }` with the real secrets, is created owner-only (`0600`) in a
  temporary folder and deleted when the turn ends (also on failure or timeout).
- The process runs in that temporary folder, not in the bridge's folder.
- With no server enabled the command stays exactly as today (`--tools ""`, text output).

**AGY:**

- The bridge keeps AGY's list in step: every enabled server is added as `sp-<name>` (`agy mcp add`, with
  `--env` / `--header`), disabled or deleted ones are removed (`agy mcp remove`). Only `sp-` entries are
  ever touched. Sync runs after each save and from Settings; its result shows in Settings.
- Chat command: `agy -p <prompt> --output-format stream-json` (plus model and effort) in an empty temporary
  folder. Whether print mode needs `--dangerously-skip-permissions` (with `--sandbox`) to call MCP tools is
  settled by the first check of the plan. If AGY cannot be limited safely, AGY chats do not get MCP tools
  (skills still apply) and Settings says so.

**Ollama and heuristic:** no MCP; skills still apply.

**Reply text and tools used:** `outputParsers` (`claudeParser`, `agyParser`) are extended to report the tool
names they see and the final reply text; the chat collects them, saves `tools_used` on the reply and shows
the line under it. Tool names from MCP servers are shown as `<server>.<tool>`.

**Time limit:** `timeLimitSeconds` for every chat turn (with or without tools). A turn that runs out ends with
"The AI did not answer within N s".

## Skills in the prompt

- **Always** skills (enabled) are added to the system prompt as:

  ```
  ## Skills
  ### <name> — <when to use>
  <instructions>
  ```

  Total size is capped at 30 KB; skills that do not fit are listed by name with "(not included: too long)".
- `/name` in the message adds that skill's instructions to this turn, Always or On request, under the same
  heading. The `/name` token stays in the message the person sees.
- Skill text is the person's own configuration; imported text is wrapped as untrusted input
  (`wrapUntrusted`) like other imported content.

## Server test

**Test** connects the way an MCP client does: `initialize`, then `tools/list`.

- `stdio`: start the command with its environment, talk JSON-RPC over stdin/stdout, stop it afterwards.
- `http`: POST the JSON-RPC requests to the URL with its headers (JSON or event-stream answers).
- Result saved as the server's `status` (`ok`, tool count or error) with a 15 s limit.

## Errors

| Situation | Behaviour |
|---|---|
| Server test fails | Badge `Failed: <reason>`; the server stays as configured (the CLI may still reach it) |
| `.mcp.json` cannot be read | 400 "Not a .mcp.json file: <reason>" |
| Import finds no `SKILL.md` | "No SKILL.md found under <folder>" |
| AGY not installed | AGY section shows "AGY not detected"; no sync |
| `agy mcp add` / `remove` fails | Settings shows the server and `agy`'s message |
| CLI fails to start an MCP server | The chat answers without it (CLI behaviour); the reply has no tools line |
| Turn over the time limit | "The AI did not answer within N s" |

## Security

- Secrets stay in the local database, are never sent to the browser, and reach Claude Code only through the
  owner-only temp file of one turn. For AGY, the sync writes the enabled servers (with their secrets) into
  AGY's own config (`~/.gemini/config/mcp_config.json`), as `agy mcp add` does; Settings says so next to
  the AGY section.
- Claude Code gets no built-in tools (`--tools ""`), only the enabled servers (`--strict-mcp-config`,
  `--allowedTools`).
- AGY runs in an empty temporary folder (and `--sandbox` if the check requires skipping permissions).
- Only `sp-` entries of AGY's list are added or removed.

## Desktop (Rule A)

Nothing new to bundle; the endpoints and command building run in the bundled server. Server tests and the
AGY sync use the same `cliBinary` lookup as the Local AI CLI engine.

## Testing

- **Settings:** round trip with secrets masked; `{ set: true }` keeps a secret; name rules; defaults.
- **`.mcp.json` import:** stdio and http entries, duplicates skipped, bad JSON refused.
- **Skills import:** front matter `name` / `description`, folder-name fallback, duplicates, Re-import.
- **Command lines:** Claude Code with and without servers (temp file content and mode, `--allowedTools`
  list, deleted afterwards); AGY command.
- **Skills in the prompt:** Always, `/name`, the 30 KB cap, untrusted wrapping of imported text.
- **Server test:** against a tiny stdio MCP test server (ok, tool count, failure, time limit).
- **AGY sync:** with a fake `agy` script recording `mcp add` / `remove`; only `sp-` entries touched.
- **Tools used:** parser tests on recorded Claude Code and AGY `stream-json` lines.
- **Web:** helpers (`.mcp.json` parsing preview, secret display, tools-used line); Settings tab via
  typecheck and build.

## Plan order

1. **Checks first** (the plan records the outcome): Claude Code `-p` with `--tools ""`, `--mcp-config`,
   `--strict-mcp-config` and `--allowedTools mcp__<server>` calls a server's tools; what AGY print mode needs
   to call an MCP tool.
2. Settings schema, endpoints and the AI Chat tab (servers, Paste .mcp.json, Test, skills, Import, time
   limit, AGY section).
3. Chat wiring: Claude Code command, AGY sync and command, skills in the prompt, `/` skills, tools used,
   time limit.
4. Docs: `09-settings-and-environment.md` (AI Chat tab), the AI Chat guide section, `10-troubleshooting.md`.

## Out of scope

- Bridge-built tools (requirements, logs, repository code), a gateway, and confirm-before-write.
- Per-workspace lists.
- Draft with AI and Improve with AI, and repository agents (they keep the repository's and the user's own
  configuration).
- Codex as a chat provider (it is not one today).
- The browser sidebar's "tool selector" pills (prompt templates).
