import readline from 'node:readline';
import { APP_VERSION } from '@sp-kickstack/shared';
import { RequirementService } from '../services/requirementService.js';
import { ProjectService } from '../services/projectService.js';
import { TicketService } from '../services/ticketService.js';
import { AppDatabase } from '../db/index.js';

export interface McpServerDependencies {
  db: AppDatabase;
  requirementService: RequirementService;
  projectService: ProjectService;
  ticketService?: TicketService;
}

const WORKSPACE_ID_HELP = 'Workspace id (shown in brackets next to the workspace name in the app header); default "default"';

export class McpServer {
  constructor(private deps: McpServerDependencies) {}

  public async handleRpcMessage(message: any): Promise<any> {
    const { id, method, params } = message;

    if (method === 'initialize') {
      return {
        jsonrpc: '2.0',
        id,
        result: {
          protocolVersion: '2024-11-05',
          serverInfo: {
            name: 'sp-kickstack-mcp',
            version: APP_VERSION,
          },
          capabilities: {
            tools: {},
          },
        },
      };
    }

    if (method === 'notifications/initialized') {
      return null;
    }

    if (method === 'tools/list') {
      return {
        jsonrpc: '2.0',
        id,
        result: {
          tools: [
            {
              name: 'sp_create_requirement',
              description: 'Create a cross-repo software requirement in SP-Kickstack',
              inputSchema: {
                type: 'object',
                properties: {
                  title: { type: 'string', description: 'Concise title of requirement' },
                  goal: { type: 'string', description: 'Detailed goal description' },
                  affected_projects: {
                    type: 'array',
                    items: { type: 'string' },
                    description: 'List of project names affected (e.g. backend, mobile, frontend)',
                  },
                  acceptance_criteria: {
                    type: 'array',
                    items: { type: 'string' },
                    description: 'Checklist of acceptance criteria items',
                  },
                  user_story: { type: 'string', description: 'As a [role], I want [action]...' },
                  priority: {
                    type: 'string',
                    enum: ['low', 'normal', 'high', 'urgent'],
                    default: 'normal',
                  },
                  workspace_id: { type: 'string', default: 'default', description: WORKSPACE_ID_HELP },
                },
                required: ['title', 'goal', 'affected_projects'],
              },
            },
            {
              name: 'sp_list_requirements',
              description: 'List existing requirements and their statuses in SP-Kickstack',
              inputSchema: {
                type: 'object',
                properties: {
                  workspace_id: { type: 'string', default: 'default', description: WORKSPACE_ID_HELP },
                },
              },
            },
            {
              name: 'sp_get_requirement',
              description: 'Get requirement details and subtasks by ID (e.g. REQ-001)',
              inputSchema: {
                type: 'object',
                properties: {
                  id: { type: 'string', description: 'Requirement ID, e.g. REQ-001' },
                },
                required: ['id'],
              },
            },
            {
              name: 'sp_list_projects',
              description: 'List registered projects and engines of one workspace in SP-Kickstack',
              inputSchema: {
                type: 'object',
                properties: {
                  workspace_id: { type: 'string', default: 'default', description: WORKSPACE_ID_HELP },
                },
              },
            },
          ],
        },
      };
    }

    if (method === 'tools/call') {
      const toolName = params?.name;
      const args = params?.arguments || {};

      try {
        if (toolName === 'sp_create_requirement') {
          const created = this.deps.requirementService.createRequirement({
            workspace_id: args.workspace_id || 'default',
            title: args.title,
            goal: args.goal,
            affected_projects: args.affected_projects || ['backend'],
            acceptance_criteria: args.acceptance_criteria || [],
            user_story: args.user_story,
            priority: args.priority || 'normal',
            status: 'draft',
          });

          return {
            jsonrpc: '2.0',
            id,
            result: {
              content: [
                {
                  type: 'text',
                  text: `Successfully created requirement ${created.id}: "${created.title}" with projects [${created.affected_projects.join(', ')}].`,
                },
              ],
              requirement: created,
            },
          };
        }

        if (toolName === 'sp_list_requirements') {
          const reqs = this.deps.requirementService.listRequirements(args.workspace_id || 'default');
          return {
            jsonrpc: '2.0',
            id,
            result: {
              content: [
                {
                  type: 'text',
                  text: JSON.stringify(
                    reqs.map((r) => ({
                      id: r.id,
                      title: r.title,
                      status: r.status,
                      projects: r.affected_projects,
                    })),
                    null,
                    2
                  ),
                },
              ],
            },
          };
        }

        if (toolName === 'sp_get_requirement') {
          const req = this.deps.requirementService.getRequirement(args.id);
          if (!req) {
            return {
              jsonrpc: '2.0',
              id,
              error: { code: -32602, message: `Requirement ${args.id} not found` },
            };
          }
          return {
            jsonrpc: '2.0',
            id,
            result: {
              content: [{ type: 'text', text: JSON.stringify(req, null, 2) }],
            },
          };
        }

        if (toolName === 'sp_list_projects') {
          const workspaceId = args.workspace_id || 'default';
          const known = this.deps.db
            .prepare("SELECT id FROM workspaces ORDER BY CASE WHEN id = 'default' THEN 0 ELSE 1 END, name")
            .all() as Array<{ id: string }>;
          if (!known.some((w) => w.id === workspaceId)) {
            // An empty list would read as "this workspace has no projects"; say the id is wrong instead.
            return {
              jsonrpc: '2.0',
              id,
              result: {
                content: [{ type: 'text', text: `No workspace "${workspaceId}". Known workspaces: ${known.map((w) => w.id).join(', ')}.` }],
              },
            };
          }
          const projs = this.deps.projectService.listProjects(workspaceId);
          return {
            jsonrpc: '2.0',
            id,
            result: {
              content: [
                {
                  type: 'text',
                  text: JSON.stringify(
                    projs.map((p) => ({
                      name: p.name,
                      kind: p.kind,
                      engine_type: p.engine_type,
                      engine_status: p.engine_status,
                    })),
                    null,
                    2
                  ),
                },
              ],
            },
          };
        }

        return {
          jsonrpc: '2.0',
          id,
          error: { code: -32601, message: `Unknown tool: ${toolName}` },
        };
      } catch (err: any) {
        return {
          jsonrpc: '2.0',
          id,
          error: { code: -32603, message: err.message || 'Tool execution error' },
        };
      }
    }

    return {
      jsonrpc: '2.0',
      id,
      error: { code: -32601, message: `Method not found: ${method}` },
    };
  }

  public startStdio(): void {
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
      terminal: false,
    });

    rl.on('line', async (line) => {
      const trimmed = line.trim();
      if (!trimmed) return;
      try {
        const parsed = JSON.parse(trimmed);
        const resp = await this.handleRpcMessage(parsed);
        if (resp) {
          process.stdout.write(JSON.stringify(resp) + '\n');
        }
      } catch (err: any) {
        process.stdout.write(
          JSON.stringify({
            jsonrpc: '2.0',
            id: null,
            error: { code: -32700, message: 'Parse error: ' + err.message },
          }) + '\n'
        );
      }
    });
  }
}
