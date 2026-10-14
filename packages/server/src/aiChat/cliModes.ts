// How the AI Chat lets each CLI call MCP tools, decided by running the real CLIs (plan Task 1, 2026-10-14).

/** Claude Code: allow each server with --allowedTools mcp__<server>, or bypass permissions (built-in tools stay off). */
export type ClaudeChatPermission = 'allowed-tools' | 'bypass';
export const CLAUDE_CHAT_PERMISSION: ClaudeChatPermission = 'allowed-tools';

/**
 * AGY print mode: 'native' calls MCP tools as is; 'sandbox' needs --sandbox; 'skip-permissions-sandboxed'
 * needs --dangerously-skip-permissions with --sandbox; 'off' = AGY chats get no MCP tools (skills only).
 * AGY 1.3.4 auto-denies the "mcp" permission in print mode, with or without --sandbox, so AGY chats get no MCP tools.
 */
export type AgyChatMcpMode = 'native' | 'sandbox' | 'skip-permissions-sandboxed' | 'off';
export const AGY_CHAT_MCP_MODE: AgyChatMcpMode = 'off';
