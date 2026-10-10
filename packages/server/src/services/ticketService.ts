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
import { HttpError, badRequest } from '../lib/httpError.js';
import crypto from 'node:crypto';
import { cancelOrphan } from './orphans.js';
import { MAX_DISPATCH_ATTEMPTS, shouldNotifyFailure } from '../lib/retryPolicy.js';
import { BranchService, branchInstructions, taskBranchName } from './branchService.js';
import { isRateLimit } from '../adapters/rateLimit.js';
import { pauseForRateLimit } from './rateLimitPause.js';
import { prepareRetry } from './taskRetry.js';

function normalizeTitle(title: string): string {
  return title.toLowerCase().replace(/\s+/g, ' ').trim();
}

export class TicketService {
  public static MAX_DEPTH = 3;
  public static MAX_TICKETS_PER_REQ = 10;
  public static MAX_BODY_BYTES = 20480;

  private branches: BranchService;

  constructor(
    private db: AppDatabase,
    private projectService: ProjectService,
    private linkService: LinkService,
    private getAdapter: AdapterFactory,
    branches?: BranchService
  ) {
    this.branches = branches ?? new BranchService(db, projectService);
  }

  public formatTicketBody(
    sourceProject: string,
    reqId: string,
    input: CreateTicketInput,
    branch?: { name: string; base: string; policy: 'manual_review_merge' | 'auto_merge' }
  ): string {
    return `# Ticket from ${oneLine(sourceProject)} — ${oneLine(input.title)}  (${reqId})

Review feasibility against the current contract and tenant-isolation rules,
write a short plan, implement, update the contract file, add tests.
If the request is unclear or unsafe, say so instead of guessing.
If you need a decision from a person, run \`xticket ask --question "..." --option "..."\`, commit WIP changes and stop; the answer arrives as a note when the task resumes.
${branch ? `\n${branchInstructions(branch.name, branch.base, branch.policy)}\n` : ''}
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
      throw badRequest(`Target project "${input.to}" is not registered`);
    }
    if (!targetProject.enabled) {
      throw badRequest(`Target project "${input.to}" is disabled`);
    }
    if (sourceProject === input.to && input.type !== 'bug') {
      throw badRequest(`Cannot file non-bug ticket to the same project "${input.to}"`);
    }
    if (Buffer.byteLength(input.body, 'utf-8') > TicketService.MAX_BODY_BYTES) {
      throw badRequest(`Ticket body exceeds maximum size of 20 KB`);
    }

    // Resolve source bridge task if sourceEngineTaskId provided
    let sourceTask: BridgeTask | undefined;
    if (sourceEngineTaskId) {
      sourceTask = this.db
        .prepare('SELECT * FROM bridge_tasks WHERE project = ? AND engine_task_id = ?')
        .get(sourceProject, sourceEngineTaskId) as BridgeTask;
    }

    // Determine req_id & depth: from the source task, else the explicit req_id. Never guess.
    let reqId: string;
    if (sourceTask) {
      reqId = sourceTask.req_id;
    } else if (input.req_id) {
      if (!this.db.prepare('SELECT 1 FROM requirements WHERE id = ?').get(input.req_id)) {
        throw badRequest(`Requirement ${input.req_id} not found`);
      }
      reqId = input.req_id;
    } else {
      throw badRequest('Cannot attribute ticket: source task not found and no req_id given');
    }
    const depth = sourceTask ? sourceTask.depth + 1 : 1;

    // Same source task + target + normalized title = the same ticket (agent retries,
    // outbox re-scans and FR-TKT-05 duplicates all land on one row).
    const idempotencyKey = crypto
      .createHash('sha256')
      .update([sourceProject, sourceEngineTaskId ?? '', reqId, input.to, normalizeTitle(input.title)].join('|'))
      .digest('hex');

    let ticket = this.findByKey(idempotencyKey);
    let ownsEngineCall = false;

    if (!ticket) {
      if (depth > TicketService.MAX_DEPTH) {
        throw new HttpError(429, `Ticket depth limit exceeded (max: ${TicketService.MAX_DEPTH})`);
      }
      const countRow = this.db
        .prepare("SELECT COUNT(*) as cnt FROM bridge_tasks WHERE req_id = ? AND role = 'ticket'")
        .get(reqId) as any;
      if (countRow.cnt >= TicketService.MAX_TICKETS_PER_REQ) {
        throw new HttpError(429, `Maximum tickets limit reached for requirement ${reqId}`);
      }

      // Reserve the row before calling the engine.
      const now = new Date().toISOString();
      const reserved = this.db
        .prepare(`
          INSERT INTO bridge_tasks (
            req_id, project, role, title, body_md, origin_task_id, depth, status,
            revision, attempts, idempotency_key, created_at, updated_at
          ) VALUES (?, ?, 'ticket', ?, ?, ?, ?, 'pending', 1, 1, ?, ?, ?)
          ON CONFLICT DO NOTHING
        `)
        .run(
          reqId,
          input.to,
          input.title,
          this.formatTicketBody(sourceProject, reqId, input),
          sourceTask ? sourceTask.id : null,
          depth,
          idempotencyKey,
          now,
          now
        );
      ownsEngineCall = reserved.changes === 1;
      if (ownsEngineCall && this.branches.usesBranches(targetProject)) {
        const id = Number(reserved.lastInsertRowid);
        const name = taskBranchName(reqId, id);
        const body = this.formatTicketBody(sourceProject, reqId, input, {
          name,
          base: this.branches.baseBranchFor(targetProject),
          policy: this.branches.policyFor(reqId),
        });
        this.db.prepare('UPDATE bridge_tasks SET branch = ?, body_md = ? WHERE id = ?').run(name, body, id);
      }
      ticket = this.findByKey(idempotencyKey)!;
    } else if (!ticket.engine_task_id) {
      // A previous attempt failed before the engine accepted it: claim the retry (capped;
      // beyond the cap the ticket stays failed and visible instead of retrying every scan).
      const reclaimed = this.db
        .prepare(`
          UPDATE bridge_tasks SET status = 'pending', attempts = attempts + 1, last_error = NULL, updated_at = ?
          WHERE id = ? AND status = 'failed' AND engine_task_id IS NULL AND attempts < ?
        `)
        .run(new Date().toISOString(), ticket.id, MAX_DISPATCH_ATTEMPTS);
      ownsEngineCall = reclaimed.changes === 1;
    }

    // A target engine that is down must not lose the dependency: the ticket row exists and
    // the retry sweep creates it later, so record the link and hold the source regardless.
    let dispatchError: unknown = null;
    if (ownsEngineCall) {
      const { attempts } = this.db.prepare('SELECT attempts FROM bridge_tasks WHERE id = ?').get(ticket.id) as { attempts: number };
      await this.dispatchTicket(ticket.id, { recordFailure: shouldNotifyFailure(attempts) }).catch((err) => {
        dispatchError = err;
      });
    }

    // Blocking: record placeholder + link first, then hold the source task.
    if (input.blocking && sourceTask) {
      await this.holdSourceUntilDone(sourceTask, ticket.id, input.to, reqId, depth);
    }

    if (dispatchError) throw dispatchError;

    const current = this.findByKey(idempotencyKey)!;
    return {
      ticketId: current.id,
      target: input.to,
      blocking: Boolean(input.blocking),
      status: current.status,
    };
  }

  /** A person retries a stopped ticket: new engine task on the same branch, attempts reset. */
  public async retryTicket(ticketId: number): Promise<BridgeTask> {
    await prepareRetry(this.db, ticketId, 'ticket', this.getAdapter);
    try {
      await this.dispatchTicket(ticketId);
    } catch {
      // Already recorded on the row (failed + last_error) and as task_failed; the caller shows it.
    }
    return this.db.prepare('SELECT * FROM bridge_tasks WHERE id = ?').get(ticketId) as BridgeTask;
  }

  /**
   * Create a reserved ('pending') ticket in its target engine; throws if the engine refuses.
   * `recordFailure: false` keeps intermediate retry-sweep failures out of notifications.
   */
  public async dispatchTicket(ticketId: number, options: { recordFailure?: boolean } = {}): Promise<void> {
    const ticket = this.db.prepare('SELECT * FROM bridge_tasks WHERE id = ?').get(ticketId) as BridgeTask | undefined;
    if (!ticket || ticket.status !== 'pending') return;

    try {
      // The work branch must exist before an agent is told to use it.
      this.branches.ensureTaskBranch(ticketId);
      const adapter = this.getAdapter(ticket.project);
      const engineTask = await adapter.createTask({
        title: ticket.title,
        bodyMd: ticket.body_md || '',
      });
      const stored = this.db
        .prepare(`
          UPDATE bridge_tasks
          SET engine_task_id = ?, status = ?, engine_status_raw = ?, engine_url = ?, last_error = NULL, updated_at = ?
          WHERE id = ? AND status = 'pending'
        `)
        .run(engineTask.id, engineTask.status, engineTask.rawStatus, engineTask.url || null, new Date().toISOString(), ticketId);
      if (stored.changes === 0) {
        await cancelOrphan(this.db, adapter, ticketId, engineTask.id);
      }
    } catch (err: any) {
      if (isRateLimit(err)) {
        // Accepted: the retry sweep creates it in the engine once the limit resets.
        pauseForRateLimit(this.db, ticketId, err);
        return;
      }
      const message = err?.message || 'Unknown adapter error';
      const now = new Date().toISOString();
      this.db
        .prepare("UPDATE bridge_tasks SET status = 'failed', last_error = ?, updated_at = ? WHERE id = ? AND status = 'pending'")
        .run(message, now, ticketId);
      if (options.recordFailure !== false) {
        this.recordEvent('task_failed', ticket.req_id, ticketId, { taskId: ticketId, project: ticket.project, error: message, stage: 'ticket' });
      }
      throw new HttpError(502, `Ticket #${ticketId} could not be created in ${ticket.project}: ${message}`);
    }
  }

  private async holdSourceUntilDone(
    sourceTask: BridgeTask,
    ticketId: number,
    target: string,
    reqId: string,
    depth: number
  ): Promise<void> {
    let link = this.linkService.getLinksForTask(sourceTask.id).find((l) => l.depends_on_id === ticketId);
    if (!link) {
      const now = new Date().toISOString();
      this.db.transaction(() => {
        const placeholder = this.db
          .prepare(`
            INSERT INTO bridge_tasks (
              req_id, project, role, engine_task_id, title,
              origin_task_id, depth, status, created_at, updated_at
            ) VALUES (?, ?, 'waiting', NULL, ?, ?, ?, 'held', ?, ?)
          `)
          .run(reqId, sourceTask.project, `Waiting on ${target} #${ticketId}`, sourceTask.id, depth, now, now);
        this.linkService.createLink(sourceTask.id, ticketId, Number(placeholder.lastInsertRowid));
      })();
      link = this.linkService.getLinksForTask(sourceTask.id).find((l) => l.depends_on_id === ticketId)!;
    }

    // Only a still-waiting link needs the source held (a resubmit after release must not re-hold).
    const source = this.db.prepare('SELECT * FROM bridge_tasks WHERE id = ?').get(sourceTask.id) as BridgeTask;
    if (link.state !== 'waiting' || source.status === 'held' || !source.engine_task_id) return;

    const now = new Date().toISOString();
    try {
      await this.getAdapter(source.project).holdTask(source.engine_task_id, `Blocked by ticket #${ticketId}`);
      this.db
        .prepare("UPDATE bridge_tasks SET status = 'held', last_error = NULL, updated_at = ? WHERE id = ?")
        .run(now, source.id);
    } catch (err: any) {
      const message = `Hold failed: ${err?.message || err}`;
      this.db.prepare('UPDATE bridge_tasks SET last_error = ?, updated_at = ? WHERE id = ?').run(message, now, source.id);
      if (isRateLimit(err)) {
        // Expected during a rate limit (the engine trip already notified): the resubmit retries quietly.
        throw new HttpError(503, `Ticket #${ticketId} was filed; the ${source.project} task is held once its engine's rate limit resets (resubmit to retry)`);
      }
      this.recordEvent('task_blocked', reqId, source.id, { taskId: source.id, ticketId, error: message });
      throw new HttpError(502, `Ticket #${ticketId} was filed but ${source.project} task could not be held (${message}); resubmit to retry`);
    }
  }

  private findByKey(key: string): BridgeTask | undefined {
    return this.db.prepare('SELECT * FROM bridge_tasks WHERE idempotency_key = ?').get(key) as BridgeTask | undefined;
  }

  public recordEvent(type: string, reqId: string | null, taskId: number | null, payload: Record<string, unknown>) {
    this.db
      .prepare('INSERT INTO events (req_id, task_id, type, payload, read, at) VALUES (?, ?, ?, ?, 0, ?)')
      .run(reqId, taskId, type, JSON.stringify(payload), new Date().toISOString());
  }
}
