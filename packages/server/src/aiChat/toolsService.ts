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
