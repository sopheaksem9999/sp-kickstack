import { describe, it, expect } from 'vitest';
import { AiDraftService } from './aiDraftService.js';
import { McpServer } from '../mcp/server.js';
import { initDatabase } from '../db/index.js';
import { RequirementService } from './requirementService.js';
import { ProjectService } from './projectService.js';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const tempWorkspace = path.resolve(__dirname, '../../.temp/sp-test-ai');

describe('AiDraftService', () => {
  const service = new AiDraftService();

  it('generates structured requirement from raw text using heuristic generator', async () => {
    const rawPrompt = 'We need Google OAuth login with rate limiting on backend and a sign-in button on frontend';
    const result = await service.draftRequirement(rawPrompt, {
      provider: 'heuristic',
      knownProjects: ['backend', 'frontend', 'mobile'],
    });

    expect(result.title).toContain('Google OAuth');
    expect(result.goal).toBe(rawPrompt);
    expect(result.user_story).toContain('As a user');
    expect(result.affected_projects).toContain('backend');
    expect(result.affected_projects).toContain('frontend');
    expect(result.acceptance_criteria.length).toBeGreaterThanOrEqual(2);
    expect(result.api_hints).toBeDefined();
    expect(result.provider_used).toBe('heuristic');
  });

  it('detects mobile and API hints for driver tracking requirement', async () => {
    const rawPrompt = 'Real-time driver location tracking over websocket for mobile app';
    const result = await service.draftRequirement(rawPrompt, {
      provider: 'heuristic',
      knownProjects: ['backend', 'mobile'],
    });

    expect(result.title).toContain('Real-time driver location');
    expect(result.affected_projects).toContain('mobile');
    expect(result.api_hints).toContain('WSS');
  });

  it('lists provider status', async () => {
    const providers = await service.getProviders();
    expect(providers.length).toBeGreaterThanOrEqual(1);
    expect(providers.some((p) => p.id === 'heuristic')).toBe(true);
  });
});

describe('McpServer JSON-RPC Protocol', () => {
  const db = initDatabase(':memory:');
  const projectService = new ProjectService(db);
  const requirementService = new RequirementService(db, tempWorkspace);
  const mcp = new McpServer({ db, projectService, requirementService });

  projectService.registerProject({
    name: 'backend',
    kind: 'backend',
    repo_path: '/tmp/backend',
    engine_type: 'manual',
    base_branch: 'main',
  });

  it('responds to initialize and tools/list', async () => {
    const initRes = await mcp.handleRpcMessage({
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: {},
    });
    expect(initRes.result.serverInfo.name).toBe('sp-kickstack-mcp');

    const toolsRes = await mcp.handleRpcMessage({
      jsonrpc: '2.0',
      id: 2,
      method: 'tools/list',
      params: {},
    });
    const toolNames = toolsRes.result.tools.map((t: any) => t.name);
    expect(toolNames).toContain('sp_create_requirement');
    expect(toolNames).toContain('sp_list_requirements');
    expect(toolNames).toContain('sp_get_requirement');
  });

  it('executes sp_create_requirement via tools/call', async () => {
    const callRes = await mcp.handleRpcMessage({
      jsonrpc: '2.0',
      id: 3,
      method: 'tools/call',
      params: {
        name: 'sp_create_requirement',
        arguments: {
          title: 'Twilio SMS Verification',
          goal: 'Send 6 digit OTP to user mobile',
          affected_projects: ['backend'],
          acceptance_criteria: ['Rate limit 3 attempts per minute', 'Validates OTP against Redis cache'],
        },
      },
    });

    expect(callRes.result.requirement).toBeDefined();
    expect(callRes.result.requirement.id).toMatch(/^REQ-\d+/);
    expect(callRes.result.requirement.title).toBe('Twilio SMS Verification');

    const listRes = await mcp.handleRpcMessage({
      jsonrpc: '2.0',
      id: 4,
      method: 'tools/call',
      params: {
        name: 'sp_list_requirements',
      },
    });
    expect(listRes.result.content[0].text).toContain('Twilio SMS Verification');
  });
});
