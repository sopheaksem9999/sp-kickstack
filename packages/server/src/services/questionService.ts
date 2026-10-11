import crypto from 'node:crypto';
import { AppDatabase } from '../db/index.js';
import {
  AgentQuestion,
  AnswerDelivery,
  AnswerQuestionInput,
  AnswerQuestionInputSchema,
  AnswerQuestionResult,
  AskQuestionInput,
  AskQuestionInputSchema,
  AskQuestionResponse,
  BridgeTask,
  NormStatus,
  QuestionStatus,
} from '@sp-kickstack/shared';
import { HttpError, badRequest, conflict } from '../lib/httpError.js';
import { isRateLimit } from '../adapters/rateLimit.js';
import { neutralize, oneLine } from '../lib/promptSafety.js';
import type { AdapterFactory } from './fanOutService.js';
import { LinkService } from './linkService.js';

export type QuestionEmit = (event: { type: string; req_id?: string; task_id?: number; payload: Record<string, unknown> }) => void;

/** Asker states with a live run: a question pauses it ('held' = already paused). */
const RUNNING: NormStatus[] = ['pending', 'queued', 'running', 'needs_human', 'rate_limited'];
/** Asker states whose run is over: a question is kept for the next run and never pauses it. */
const STOPPED: NormStatus[] = ['in_review', 'qa', 'done', 'failed', 'cancelled'];
const PAUSED_MESSAGE =
  'Your task is paused until a person answers. Stop working now; the answer arrives as a note when the task resumes.';
const STOPPED_MESSAGE =
  "Your task's run is over, so it was not paused. A person will see the question; their answer is passed to the next run of this task.";

type QuestionRow = BridgeTask & {
  options: string | null;
  answer_md: string | null;
  answered_at: string | null;
  asker_status: NormStatus | null;
};

/** Question rows with the status of the task that asked. */
const SELECT_QUESTIONS = `
  SELECT q.*, a.status AS asker_status FROM bridge_tasks q
  LEFT JOIN bridge_tasks a ON a.id = q.origin_task_id
  WHERE q.role = 'question'`;

/** The note an answer reaches the agent with. */
function answerContext(question: string, answer: string): string {
  return `## Answer from a person\nYou asked: ${oneLine(question, 500)}\n\n${neutralize(answer)}\n\nContinue with this answer.`;
}

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
    asker_status: row.asker_status ?? 'cancelled',
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
        ? this.db.prepare(`${SELECT_QUESTIONS} AND q.req_id = ? ORDER BY q.id DESC LIMIT 200`).all(filter.reqId)
        : this.db.prepare(`${SELECT_QUESTIONS} ORDER BY q.id DESC LIMIT 200`).all()
    ) as QuestionRow[];
    const questions = rows.map(toQuestion);
    return filter.status ? questions.filter((q) => q.status === filter.status) : questions;
  }

  /**
   * File a question for the agent's task and pause that task while its run is going. A task whose
   * run is over (in review, merged, failed) is never paused: its answer becomes a review comment
   * for the next run. Idempotent per task and question text.
   */
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
    const runOver = STOPPED.includes(current.asker_status as NormStatus);
    return {
      questionId: current.id,
      taskId: source.id,
      status,
      held,
      answer: current.answer_md ?? null,
      message: status === 'open' ? (runOver ? STOPPED_MESSAGE : PAUSED_MESSAGE) : `This question was already ${status}.`,
    };
  }

  /** Answer an open question and resume (or note) the asking task; says how the answer was delivered. */
  public async answer(questionId: number, input: AnswerQuestionInput): Promise<AnswerQuestionResult> {
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
    const delivered = await this.deliverAnswer(sourceId, questionId, answerContext(row.title, text));

    this.recordEvent('question_answered', row.req_id, sourceId, {
      questionId, taskId: sourceId, reqId: row.req_id, project: row.project, answer: oneLine(text, 200),
    });
    return { ...this.get(questionId)!, delivered };
  }

  /**
   * Pause the asking task while its question is open; true while it is held. Only a running task
   * is paused, and 'held' is written only if the task did not move on (for example to review)
   * while the engine call was in flight. The question is already visible, so a person may answer
   * meanwhile: the answer then waits on its link (see deliverAnswer) and is delivered here once
   * the hold has settled.
   */
  private async holdAsker(question: QuestionRow, sourceId: number): Promise<boolean> {
    const source = this.task(sourceId);
    if (source.status === 'held') return true;
    if (!RUNNING.includes(source.status)) return false;
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
        // Answered meanwhile: the task never paused, so the answer goes as a note (or a review comment).
        await this.settleUnheldAnswer(sourceId, question.id);
        if (isRateLimit(err)) {
          throw new HttpError(503, `Question #${question.id} was filed; your task pauses once the ${source.project} engine's rate limit resets (resubmit to retry)`);
        }
        throw new HttpError(502, `Question #${question.id} was filed but your task could not be paused (${message}); resubmit to retry`);
      }
      // Compare-and-set: only a task still running on the engine task we held becomes 'held'. Any
      // running state counts: the retry sweep may have moved it to 'queued' meanwhile (see
      // resumeIfWaitEnded), and the engine task is held either way.
      const wrote = this.db
        .prepare(`
          UPDATE bridge_tasks SET status = 'held', last_error = NULL, updated_at = ?
          WHERE id = ? AND engine_task_id = ? AND status IN (${RUNNING.map(() => '?').join(', ')})
        `)
        .run(now, sourceId, source.engine_task_id, ...RUNNING);
      const current = this.task(sourceId);
      const heldMeanwhile = current.status === 'held' && current.engine_task_id === source.engine_task_id;
      if (wrote.changes !== 1 && !heldMeanwhile) {
        // The task moved on while the hold was in flight (for example its run ended): keep its
        // status; a stored answer goes where the task now is.
        await this.settleUnheldAnswer(sourceId, question.id);
        return false;
      }

      await this.resumeIfWaitEnded(sourceId, question.id);
      return this.task(sourceId).status === 'held';
    } finally {
      this.holding.delete(sourceId);
    }
  }

  /**
   * The hold landed, but the wait for the answer may have ended meanwhile: answered (the retry
   * sweep may even have released the link already), or an operator cancelled or released the
   * link. If nothing else holds the task, resume it now so it is not left paused for nothing.
   */
  private async resumeIfWaitEnded(sourceId: number, questionId: number) {
    // A release the sweep could not complete left the answer on the link: send it with this release.
    this.db.prepare("UPDATE links SET state = 'ready' WHERE task_id = ? AND depends_on_id = ? AND state = 'error'").run(sourceId, questionId);
    const state = this.linkStateOf(sourceId, questionId);
    const waiting = this.db.prepare("SELECT COUNT(*) AS c FROM links WHERE task_id = ? AND state = 'waiting'").get(sourceId) as { c: number };
    if (state === 'waiting' || waiting.c > 0) return;
    // A ready link carries the answer itself; a failed release stays for the sweeper.
    if (state === 'ready') {
      await this.linkService.releaseSourceIfUnblocked(sourceId);
      return;
    }
    const question = this.row(questionId)!;
    const extra =
      question.status === 'done' && question.answer_md != null
        ? answerContext(question.title, question.answer_md)
        : `## Question withdrawn\nNobody will answer question #${questionId}; continue with your best judgment and note the choice in your report.`;
    await this.linkService.releaseSourceIfUnblocked(sourceId, extra);
  }

  /** The link to a question once its answer is stored on it and awaits delivery. */
  private answeredLink(sourceId: number, questionId: number): { context_md: string | null } | undefined {
    return this.db
      .prepare("SELECT context_md FROM links WHERE task_id = ? AND depends_on_id = ? AND state = 'ready'")
      .get(sourceId, questionId) as { context_md: string | null } | undefined;
  }

  /**
   * Run over: the answer becomes a review comment for the next run (no engine call). Held and
   * waiting on nothing else: release with the answer (a failed release leaves the link in
   * 'error' for the sweeper). Otherwise send the answer as a note now; a task still held by
   * another dependency gets it again with the final release.
   */
  private async deliverAnswer(sourceId: number, questionId: number, context: string): Promise<AnswerDelivery> {
    const source = this.task(sourceId);
    if (STOPPED.includes(source.status)) {
      this.db.transaction(() => {
        this.db
          .prepare("UPDATE links SET state = 'released', released_at = ? WHERE task_id = ? AND depends_on_id = ? AND state IN ('waiting', 'ready', 'error')")
          .run(new Date().toISOString(), sourceId, questionId);
        this.addAnswerComment(source, questionId);
      })();
      return 'review_comment';
    }

    const ready = this.db
      .prepare("UPDATE links SET state = 'ready', context_md = ? WHERE task_id = ? AND depends_on_id = ? AND state = 'waiting'")
      .run(context, sourceId, questionId);
    if (ready.changes !== 1) {
      // Nothing waits on the answer any more (an operator released or cancelled the wait): tell the agent.
      await this.noteAnswer(source, questionId, context, false);
      return 'note';
    }
    // The task's engine hold is still in flight: holdAsker delivers the stored answer when it settles.
    if (this.holding.has(sourceId)) return 'pending';

    const stillWaiting = (
      this.db.prepare("SELECT COUNT(*) AS c FROM links WHERE task_id = ? AND state = 'waiting'").get(sourceId) as { c: number }
    ).c;

    if (source.status === 'held' && stillWaiting === 0) {
      await this.linkService.releaseSourceIfUnblocked(sourceId);
      return this.linkStateOf(sourceId, questionId) === 'released' ? 'resumed' : 'pending';
    }
    if (source.status === 'held') {
      await this.noteAnswer(source, questionId, context, false);
      return 'noted';
    }
    await this.noteAnswer(source, questionId, context, true);
    return 'note';
  }

  /**
   * The hold did not take (it failed, or the task moved on meanwhile): an answer stored on the
   * link goes to a running agent as a note, or becomes a review comment when its run is over.
   */
  private async settleUnheldAnswer(sourceId: number, questionId: number) {
    const answered = this.answeredLink(sourceId, questionId);
    if (!answered) return;
    const source = this.task(sourceId);
    if (!STOPPED.includes(source.status)) {
      await this.noteAnswer(source, questionId, answered.context_md || '', true);
      return;
    }
    this.db.transaction(() => {
      const settled = this.db
        .prepare("UPDATE links SET state = 'released', released_at = ? WHERE task_id = ? AND depends_on_id = ? AND state = 'ready'")
        .run(new Date().toISOString(), sourceId, questionId);
      if (settled.changes === 1) this.addAnswerComment(source, questionId);
    })();
  }

  /** An open review comment with the answer, so the next "Request changes" run of the task carries it. */
  private addAnswerComment(source: BridgeTask, questionId: number) {
    const question = this.row(questionId)!;
    const now = new Date().toISOString();
    this.db
      .prepare(`
        INSERT INTO review_comments (req_id, task_id, file_path, line, body_md, state, created_at, updated_at)
        VALUES (?, ?, NULL, NULL, ?, 'open', ?, ?)
      `)
      .run(source.req_id, source.id, `Answer to your question "${oneLine(question.title, 200)}": ${question.answer_md ?? ''}`, now, now);
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

  private linkStateOf(sourceId: number, questionId: number): string | undefined {
    return (this.db.prepare('SELECT state FROM links WHERE task_id = ? AND depends_on_id = ?').get(sourceId, questionId) as { state: string } | undefined)
      ?.state;
  }

  private task(id: number): BridgeTask {
    return this.db.prepare('SELECT * FROM bridge_tasks WHERE id = ?').get(id) as BridgeTask;
  }

  private row(id: number): QuestionRow | undefined {
    return this.db.prepare(`${SELECT_QUESTIONS} AND q.id = ?`).get(id) as QuestionRow | undefined;
  }

  private recordEvent(type: string, reqId: string, taskId: number, payload: Record<string, unknown>) {
    this.db
      .prepare('INSERT INTO events (req_id, task_id, type, payload, read, at) VALUES (?, ?, ?, ?, 0, ?)')
      .run(reqId, taskId, type, JSON.stringify(payload), new Date().toISOString());
    this.emit?.({ type, req_id: reqId, task_id: taskId, payload });
  }
}
