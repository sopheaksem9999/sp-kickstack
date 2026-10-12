// The MCP server stays inside one workspace: `workspace_id` (default `default`) scopes projects and new requirements.
import { describe, it, expect, beforeEach, afterEach, afterAll } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { initDatabase } from '../db/index.js';
import { ProjectService } from '../services/projectService.js';
import { RequirementService } from '../services/requirementService.js';
import { McpServer } from './server.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const tempRoot = path.resolve(__dirname, '../../.temp/sp-test-mcp');
let n = 0;

function makeHarness() {
  const ws = path.join(tempRoot, `case-${process.pid}-${n++}`);
  const db = initDatabase(':memory:');
  const projectService = new ProjectService(db);
  const requirementService = new RequirementService(db, ws);
  const server = new McpServer({ db, projectService, requirementService });

  db.exec(`INSERT INTO workspaces (id, name, created_at, updated_at) VALUES ('speedx', 'Speedx', 'x', 'x')`);
  for (const [name, workspace_id] of [['web', 'default'], ['backend', 'speedx'], ['mobile', 'speedx']] as const) {
    fs.mkdirSync(path.join(ws, name), { recursive: true });
    projectService.registerProject({
      name, kind: name === 'web' ? 'frontend' : name, repo_path: path.join(ws, name), engine_type: 'manual',
      base_branch: 'develop', enabled: true, workspace_id,
    } as any);
  }

  const call = async (name: string, args: Record<string, unknown>) =>
    server.handleRpcMessage({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } });
  const listedProjects = async (args: Record<string, unknown> = {}) => {
    const res = await call('sp_list_projects', args);
    return (JSON.parse(res.result.content[0].text) as Array<{ name: string }>).map((p) => p.name);
  };
  return { db, requirementService, server, call, listedProjects };
}

type H = ReturnType<typeof makeHarness>;

afterAll(() => fs.rmSync(tempRoot, { recursive: true, force: true }));

describe('MCP workspace scope', () => {
  let h: H;
  beforeEach(() => { h = makeHarness(); });
  afterEach(() => h.db.close());

  it('sp_list_projects lists only the projects of the given workspace, the default one without it', async () => {
    expect(await h.listedProjects({ workspace_id: 'speedx' })).toEqual(['backend', 'mobile']);
    expect(await h.listedProjects()).toEqual(['web']);
    expect(await h.listedProjects({ workspace_id: 'default' })).toEqual(['web']);
  });

  it('sp_list_projects names the known workspaces when the workspace id does not exist, instead of an empty list', async () => {
    const res = await h.call('sp_list_projects', { workspace_id: 'nowhere' });

    expect(res.error).toBeUndefined();
    expect(res.result.content).toEqual([{ type: 'text', text: 'No workspace "nowhere". Known workspaces: default, speedx.' }]);
  });

  it('sp_list_projects still lists an existing workspace that has no projects as an empty list', async () => {
    h.db.exec(`INSERT INTO workspaces (id, name, created_at, updated_at) VALUES ('empty', 'Empty', 'x', 'x')`);

    expect(await h.listedProjects({ workspace_id: 'empty' })).toEqual([]);
  });

  it('sp_create_requirement creates the requirement in the given workspace and drops other workspaces\' projects', async () => {
    const res = await h.call('sp_create_requirement', {
      title: 'Speedx work', goal: 'Do it', affected_projects: ['backend', 'web'], workspace_id: 'speedx',
    });

    const created = res.result.requirement;
    expect(created).toMatchObject({ workspace_id: 'speedx', affected_projects: ['backend'] });
    expect(h.requirementService.getRequirement(created.id)).toMatchObject({ workspace_id: 'speedx', affected_projects: ['backend'] });
    expect(h.requirementService.listRequirements('speedx').map((r) => r.id)).toEqual([created.id]);
    expect(h.requirementService.listRequirements('default')).toEqual([]);
  });

  it('sp_create_requirement without a workspace uses the default one', async () => {
    const res = await h.call('sp_create_requirement', { title: 'Web work', goal: 'Do it', affected_projects: ['web', 'backend'] });

    expect(res.result.requirement).toMatchObject({ workspace_id: 'default', affected_projects: ['web'] });
  });

  it('declares workspace_id on both tools', async () => {
    const res = await h.server.handleRpcMessage({ jsonrpc: '2.0', id: 1, method: 'tools/list' });
    const tools = res.result.tools as Array<{ name: string; inputSchema: { properties: Record<string, any> } }>;

    for (const name of ['sp_list_projects', 'sp_create_requirement']) {
      const tool = tools.find((t) => t.name === name)!;
      expect(tool.inputSchema.properties.workspace_id).toMatchObject({ type: 'string', default: 'default' });
    }
  });

  it('describes workspace_id as the id shown next to the workspace name in the app header', async () => {
    const res = await h.server.handleRpcMessage({ jsonrpc: '2.0', id: 1, method: 'tools/list' });
    const tools = res.result.tools as Array<{ name: string; inputSchema: { properties: Record<string, any> } }>;

    for (const tool of tools.filter((t) => t.inputSchema.properties.workspace_id)) {
      expect(tool.inputSchema.properties.workspace_id.description).toBe(
        'Workspace id (shown in brackets next to the workspace name in the app header); default "default"'
      );
    }
    expect(tools.filter((t) => t.inputSchema.properties.workspace_id).map((t) => t.name)).toEqual([
      'sp_create_requirement', 'sp_list_requirements', 'sp_list_projects',
    ]);
  });
});
