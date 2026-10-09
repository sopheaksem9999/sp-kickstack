import { AppDatabase } from '../db/index.js';
import { ProjectService } from './projectService.js';
import { LinkService } from './linkService.js';
import { AdapterFactory } from './fanOutService.js';
import {
  CreateTicketInput,
  TicketResponse,
  BridgeTask,
} from '@sp-kickstack/shared';
import { oneLine, wrapUntrusted } from '../lib/promptSafety.js';

export class TicketService {
  public static MAX_DEPTH = 3;
  public static MAX_TICKETS_PER_REQ = 10;
  public static MAX_BODY_BYTES = 20480;

  constructor(
    private db: AppDatabase,
    private projectService: ProjectService,
    private linkService: LinkService,
    private getAdapter: AdapterFactory
  ) {}

  public formatTicketBody(
    sourceProject: string,
    reqId: string,
    input: CreateTicketInput
  ): string {
    return `# Ticket from ${sourceProject} — ${oneLine(input.title)}  (${reqId})

Review feasibility against the current contract and tenant-isolation rules,
write a short plan, implement, update the contract file, add tests.
If the request is unclear or unsafe, say so instead of guessing.

${wrapUntrusted('ticket', `Type: ${input.type}\nTitle: ${input.title}\n\n${input.body}`)}
`;
  }

  public async createTicket(
    input: CreateTicketInput,
    sourceProject: string,
    sourceEngineTaskId?: string
  ): Promise<TicketResponse> {
    // 1. Validation
    const targetProject = this.projectService.getProject(input.to);
    if (!targetProject) {
      throw new Error(`Target project "${input.to}" is not registered`);
    }
    if (!targetProject.enabled) {
      throw new Error(`Target project "${input.to}" is disabled`);
    }
    if (sourceProject === input.to && input.type !== 'bug') {
      throw new Error(`Cannot file non-bug ticket to the same project "${input.to}"`);
    }
    if (Buffer.byteLength(input.body, 'utf-8') > TicketService.MAX_BODY_BYTES) {
      throw new Error(`Ticket body exceeds maximum size of 20 KB`);
    }

    // Resolve source bridge task if sourceEngineTaskId provided
    let sourceTask: BridgeTask | undefined;
    if (sourceEngineTaskId) {
      sourceTask = this.db
        .prepare('SELECT * FROM bridge_tasks WHERE project = ? AND engine_task_id = ?')
        .get(sourceProject, sourceEngineTaskId) as BridgeTask;
    }

    // Determine req_id & depth
    const reqId = sourceTask ? sourceTask.req_id : 'REQ-001';
    const depth = sourceTask ? sourceTask.depth + 1 : 1;

    if (depth > TicketService.MAX_DEPTH) {
      throw new Error(`Ticket depth limit exceeded (max: ${TicketService.MAX_DEPTH})`);
    }

    // Check per-requirement ticket count
    const countRow = this.db
      .prepare("SELECT COUNT(*) as cnt FROM bridge_tasks WHERE req_id = ? AND role = 'ticket'")
      .get(reqId) as any;
    if (countRow.cnt >= TicketService.MAX_TICKETS_PER_REQ) {
      throw new Error(`Maximum tickets limit reached for requirement ${reqId}`);
    }

    // 2. Create task in target engine
    const targetAdapter = this.getAdapter(input.to);
    const bodyMd = this.formatTicketBody(sourceProject, reqId, input);
    const engineTask = await targetAdapter.createTask({
      title: input.title,
      bodyMd,
    });

    const now = new Date().toISOString();
    const info = this.db
      .prepare(`
        INSERT INTO bridge_tasks (
          req_id, project, role, engine_task_id, title, body_md,
          origin_task_id, depth, status, engine_status_raw, engine_url,
          revision, created_at, updated_at
        ) VALUES (?, ?, 'ticket', ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)
      `)
      .run(
        reqId,
        input.to,
        engineTask.id,
        input.title,
        bodyMd,
        sourceTask ? sourceTask.id : null,
        depth,
        engineTask.status,
        engineTask.rawStatus,
        engineTask.url || null,
        now,
        now
      );

    const ticketTaskId = Number(info.lastInsertRowid);

    // 3. Handle blocking placeholder and link
    if (input.blocking && sourceTask) {
      // Put source engine task on hold
      const sourceAdapter = this.getAdapter(sourceProject);
      await sourceAdapter.holdTask(sourceTask.engine_task_id!, `Blocked by ticket #${ticketTaskId}`);

      // Mark source bridge task held
      this.db
        .prepare("UPDATE bridge_tasks SET status = 'held', updated_at = ? WHERE id = ?")
        .run(now, sourceTask.id);

      // Create placeholder task in source engine if needed
      const placeholder = this.db
        .prepare(`
          INSERT INTO bridge_tasks (
            req_id, project, role, engine_task_id, title,
            origin_task_id, depth, status, created_at, updated_at
          ) VALUES (?, ?, 'waiting', ?, ?, ?, ?, 'held', ?, ?)
        `)
        .run(
          reqId,
          sourceProject,
          null,
          `Waiting on ${input.to} #${ticketTaskId}`,
          sourceTask.id,
          depth,
          now,
          now
        );

      const placeholderId = Number(placeholder.lastInsertRowid);

      // Create link
      this.linkService.createLink(sourceTask.id, ticketTaskId, placeholderId);
    }

    return {
      ticketId: ticketTaskId,
      target: input.to,
      blocking: Boolean(input.blocking),
      status: engineTask.status,
    };
  }
}
