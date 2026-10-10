import crypto from 'node:crypto';
import { AppDatabase } from '../db/index.js';
import {
  AgentQuestion,
  AnswerQuestionInput,
  AnswerQuestionInputSchema,
  AskQuestionInput,
  AskQuestionInputSchema,
  AskQuestionResponse,
  BridgeTask,
  QuestionStatus,
} from '@sp-kickstack/shared';
import { HttpError, badRequest, conflict } from '../lib/httpError.js';
import { isRateLimit } from '../adapters/rateLimit.js';
import { neutralize, oneLine } from '../lib/promptSafety.js';
import type { AdapterFactory } from './fanOutService.js';
import { LinkService } from './linkService.js';

export type QuestionEmit = (event: { type: string; req_id?: string; task_id?: number; payload: Record<string, unknown> }) => void;

/** An asking task in one of these states can no longer wait for an answer. */
const FINISHED = ['done', 'cancelled', 'failed'];
const PAUSED_MESSAGE =
  'Your task is paused until a person answers. Stop working now; the answer arrives as a note when the task resumes.';

type QuestionRow = BridgeTask & { options: string | null; answer_md: string | null; answered_at: string | null };

function statusOf(row: QuestionRow): QuestionStatus {
  if (row.status === 'needs_human') return 'open';
  if (row.status === 'done') return 'answered';
  return 'cancelled';
}

function toQuestion(row: QuestionRow): AgentQuestion {
  let options: string[] = [];
  try {
    const parsed = JSON.parse(row.options || '[]');
    if (Array.isArray(parsed)) options = parsed.map(String);
  } catch {
    // A damaged options column shows as free-text only.
  }
  return {
    id: row.id,
    req_id: row.req_id,
    task_id: row.origin_task_id as number,
    project: row.project,
    question: row.title,
    details: row.body_md || '',
    options,
    status: statusOf(row),
    answer: row.answer_md ?? null,
    answered_at: row.answered_at ?? null,
    created_at: row.created_at,
  };
}

/**
 * Questions agents ask people. A question is a bridge task (role 'question') that the asking
 * task depends on through a link, so the hold/release machinery pauses the agent while the
 * question is open and resumes it with the answer (failed releases are retried by the sweeper).
 */
export class QuestionService {
  /** Asking tasks whose engine hold is in flight; an answer arriving meanwhile is delivered by the hold path. */
  private holding = new Set<number>();

  constructor(
    private db: AppDatabase,
    private linkService: LinkService,
    private getAdapter: AdapterFactory,
    private emit?: QuestionEmit
  ) {}

  public get(id: number): AgentQuestion | null {
    const row = this.row(id);
    return row ? toQuestion(row) : null;
  }

  public list(filter: { reqId?: string; status?: QuestionStatus } = {}): AgentQuestion[] {
    const rows = (
      filter.reqId
        ? this.db.prepare("SELECT * FROM bridge_tasks WHERE role = 'question' AND req_id = ? ORDER BY id DESC LIMIT 200").all(filter.reqId)
        : this.db.prepare("SELECT * FROM bridge_tasks WHERE role = 'question' ORDER BY id DESC LIMIT 200").all()
    ) as QuestionRow[];
    const questions = rows.map(toQuestion);
    return filter.status ? questions.filter((q) => q.status === filter.status) : questions;
  }

  /** File a question for the agent's task and pause that task. Idempotent per task and question text. */
  public async ask(input: AskQuestionInput, sourceProject: string, sourceEngineTaskId?: string): Promise<AskQuestionResponse> {
    const parsed = AskQuestionInputSchema.parse(input);
    if (!sourceEngineTaskId) {
      throw badRequest('A question must come from an agent task: set XTICKET_TASK to your engine task id');
    }
    const source = this.db
      .prepare("SELECT * FROM bridge_tasks WHERE project = ? AND engine_task_id = ? AND role IN ('goal', 'ticket') ORDER BY id DESC LIMIT 1")
      .get(sourceProject, sourceEngineTaskId) as BridgeTask | undefined;
    if (!source) throw new HttpError(404, `No task ${sourceEngineTaskId} in project ${sourceProject}`);

    const normalized = parsed.question.toLowerCase().replace(/\s+/g, ' ');
    const key = crypto.createHash('sha256').update(['question', source.id, normalized].join('|')).digest('hex');
    let row = this.db.prepare('SELECT * FROM bridge_tasks WHERE idempotency_key = ?').get(key) as QuestionRow | undefined;

    let created = false;
    if (!row) {
      if (FINISHED.includes(source.status)) throw conflict(`Task #${source.id} is ${source.status}; it cannot ask questions`);
      const req = this.db.prepare('SELECT status FROM requirements WHERE id = ?').get(source.req_id) as { status: string } | undefined;
      if (!req || req.status === 'cancelled' || req.status === 'done') {
        throw conflict(`Requirement ${source.req_id} is ${req?.status ?? 'missing'}; it takes no questions`);
      }
      const now = new Date().toISOString();
      const id = this.db.transaction(() => {
        const info = this.db
          .prepare(`
            INSERT INTO bridge_tasks (
              req_id, project, role, engine_task_id, title, body_md, origin_task_id, depth, status,
              revision, attempts, idempotency_key, options, created_at, updated_at
            ) VALUES (?, ?, 'question', NULL, ?, ?, ?, ?, 'needs_human', ?, 0, ?, ?, ?, ?)
          `)
          .run(
            source.req_id, source.project, oneLine(parsed.question, 500), parsed.body, source.id, source.depth ?? 0,
            source.revision ?? 1, key, JSON.stringify(parsed.options), now, now
          );
        const questionId = Number(info.lastInsertRowid);
        this.linkService.createLink(source.id, questionId, null);
        return questionId;
      })();
      row = this.row(id)!;
      created = true;
    }

    let held: boolean;
    try {
      held = await this.holdAsker(row, source.id);
    } finally {
      // Announced after the hold attempt (also a failed one), so it fires once per question.
      // A person can already answer while the hold is in flight; holdAsker then delivers that answer.
      if (created) {
        this.recordEvent('question_asked', row.req_id, source.id, {
          questionId: row.id, taskId: source.id, reqId: row.req_id, project: row.project,
          question: row.title, options: toQuestion(row).options,
        });
      }
    }

    const current = this.row(row.id)!;
    const status = statusOf(current);
    return {
      questionId: current.id,
      taskId: source.id,
      status,
      held,
      answer: current.answer_md ?? null,
      message: status === 'open' ? PAUSED_MESSAGE : `This question was already ${status}.`,
    };
  }

  /** Answer an open question and resume (or note) the asking task. */
  public async answer(questionId: number, input: AnswerQuestionInput): Promise<AgentQuestion> {
    const parsed = AnswerQuestionInputSchema.parse(input);
    const row = this.row(questionId);
    if (!row) throw new HttpError(404, `Question #${questionId} not found`);
    if (parsed.option && !toQuestion(row).options.includes(parsed.option)) {
      throw badRequest(`"${parsed.option}" is not one of the options`);
    }
    if (row.status !== 'needs_human') throw conflict(`Question #${questionId} is already ${statusOf(row)}`);

    const text = parsed.option ? (parsed.answer ? `${parsed.option} — ${parsed.answer}` : parsed.option) : parsed.answer;
    const now = new Date().toISOString();
    const claimed = this.db
      .prepare("UPDATE bridge_tasks SET status = 'done', answer_md = ?, answered_at = ?, updated_at = ? WHERE id = ? AND status = 'needs_human'")
      .run(text, now, now, questionId);
    if (claimed.changes !== 1) throw conflict(`Question #${questionId} was answered meanwhile`);

    const sourceId = row.origin_task_id as number;
    const context = `## Answer from a person\nYou asked: ${oneLine(row.title, 500)}\n\n${neutralize(text)}\n\nContinue with this answer.`;
    await this.deliverAnswer(sourceId, questionId, context);

    this.recordEvent('question_answered', row.req_id, sourceId, {
      questionId, taskId: sourceId, reqId: row.req_id, project: row.project, answer: oneLine(text, 200),
    });
    return this.get(questionId)!;
  }

  /**
   * Pause the asking task while its question is open; true while it is held. The question is
   * already visible, so a person may answer while the engine call is in flight: the answer then
   * waits on its link (see deliverAnswer) and is delivered here once the hold has settled.
   */
  private async holdAsker(question: QuestionRow, sourceId: number): Promise<boolean> {
    const source = this.db.prepare('SELECT * FROM bridge_tasks WHERE id = ?').get(sourceId) as BridgeTask;
    if (source.status === 'held') return true;
    const link = this.db.prepare('SELECT state FROM links WHERE task_id = ? AND depends_on_id = ?').get(sourceId, question.id) as
      | { state: string }
      | undefined;
    if (question.status !== 'needs_human' || link?.state !== 'waiting' || !source.engine_task_id) return false;

    this.holding.add(sourceId);
    try {
      const now = new Date().toISOString();
      try {
        await this.getAdapter(source.project).holdTask(source.engine_task_id, `Waiting for a person to answer question #${question.id}`);
      } catch (err: any) {
        const message = err?.message || String(err);
        this.db.prepare('UPDATE bridge_tasks SET last_error = ?, updated_at = ? WHERE id = ?').run(`Hold failed: ${message}`, now, sourceId);
        // Answered meanwhile: the task never paused, so the answer goes as a note.
        const answered = this.answeredLink(sourceId, question.id);
        if (answered) await this.noteAnswer(source, question.id, answered.context_md || '', true);
        if (isRateLimit(err)) {
          throw new HttpError(503, `Question #${question.id} was filed; your task pauses once the ${source.project} engine's rate limit resets (resubmit to retry)`);
        }
        throw new HttpError(502, `Question #${question.id} was filed but your task could not be paused (${message}); resubmit to retry`);
      }
      this.db.prepare("UPDATE bridge_tasks SET status = 'held', last_error = NULL, updated_at = ? WHERE id = ?").run(now, sourceId);

      if (this.answeredLink(sourceId, question.id)) {
        // Answered while the hold was in flight: resume with the answer (a failed release stays for the sweeper).
        await this.linkService.releaseSourceIfUnblocked(sourceId);
        const current = this.db.prepare('SELECT status FROM bridge_tasks WHERE id = ?').get(sourceId) as { status: string };
        return current.status === 'held';
      }
      return true;
    } finally {
      this.holding.delete(sourceId);
    }
  }

  /** The link to a question once its answer is stored on it and awaits delivery. */
  private answeredLink(sourceId: number, questionId: number): { context_md: string | null } | undefined {
    return this.db
      .prepare("SELECT context_md FROM links WHERE task_id = ? AND depends_on_id = ? AND state = 'ready'")
      .get(sourceId, questionId) as { context_md: string | null } | undefined;
  }

  /**
   * Held and waiting on nothing else: release with the answer (a failed release leaves the
   * link in 'error' for the sweeper). Otherwise send the answer as a note now; a task still
   * held by another dependency gets it again with the final release.
   */
  private async deliverAnswer(sourceId: number, questionId: number, context: string) {
    const ready = this.db
      .prepare("UPDATE links SET state = 'ready', context_md = ? WHERE task_id = ? AND depends_on_id = ? AND state = 'waiting'")
      .run(context, sourceId, questionId);
    if (ready.changes !== 1) return;
    // The task's engine hold is still in flight: holdAsker delivers the stored answer when it settles.
    if (this.holding.has(sourceId)) return;

    const source = this.db.prepare('SELECT * FROM bridge_tasks WHERE id = ?').get(sourceId) as BridgeTask;
    const stillWaiting = (
      this.db.prepare("SELECT COUNT(*) AS c FROM links WHERE task_id = ? AND state = 'waiting'").get(sourceId) as { c: number }
    ).c;

    if (source.status === 'held' && stillWaiting === 0) {
      await this.linkService.releaseSourceIfUnblocked(sourceId);
      return;
    }
    await this.noteAnswer(source, questionId, context, source.status !== 'held');
  }

  /** Send the answer to the engine task as a note (best effort); `settle` also marks its link released. */
  private async noteAnswer(source: BridgeTask, questionId: number, context: string, settle: boolean) {
    if (source.engine_task_id) {
      try {
        await this.getAdapter(source.project).appendNote(source.engine_task_id, context);
      } catch {
        // Kept on the link; a held task gets it with the final release.
      }
    }
    if (settle) {
      this.db
        .prepare("UPDATE links SET state = 'released', released_at = ? WHERE task_id = ? AND depends_on_id = ? AND state = 'ready'")
        .run(new Date().toISOString(), source.id, questionId);
    }
  }

  private row(id: number): QuestionRow | undefined {
    return this.db.prepare("SELECT * FROM bridge_tasks WHERE id = ? AND role = 'question'").get(id) as QuestionRow | undefined;
  }

  private recordEvent(type: string, reqId: string, taskId: number, payload: Record<string, unknown>) {
    this.db
      .prepare('INSERT INTO events (req_id, task_id, type, payload, read, at) VALUES (?, ?, ?, ?, 0, ?)')
      .run(reqId, taskId, type, JSON.stringify(payload), new Date().toISOString());
    this.emit?.({ type, req_id: reqId, task_id: taskId, payload });
  }
}
