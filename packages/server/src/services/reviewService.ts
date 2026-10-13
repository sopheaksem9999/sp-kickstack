import fs from 'node:fs';
import path from 'node:path';
import { AppDatabase } from '../db/index.js';
import {
  CreateReviewCommentInput,
  CreateReviewCommentInputSchema,
  ImproveReviewCommentInput,
  ImproveReviewCommentResult,
  RequestChangesInput,
  RequestChangesInputSchema,
  RequestChangesResult,
  ReviewComment,
  SendTaskNoteInput,
  SendTaskNoteInputSchema,
  UpdateReviewCommentInput,
  UpdateReviewCommentInputSchema,
} from '@sp-kickstack/shared';
import { HttpError, badRequest, conflict } from '../lib/httpError.js';
import { isRateLimit } from '../adapters/rateLimit.js';
import { neutralize, oneLine } from '../lib/promptSafety.js';
import type { AdapterFactory, FanOutService } from './fanOutService.js';
import type { TicketService } from './ticketService.js';
import type { RequirementService } from './requirementService.js';
import { rerunTask, TaskRow } from './taskRetry.js';
import { ReviewAssistService, isSafeRelativePath } from './reviewAssist.js';
import { attachmentPath, decodeUploads, listAttachments, writeAttachments } from './reviewAttachments.js';

/** Task states that can be sent back to their agent. */
const REVIEWABLE = ['in_review', 'done'];
/** After review the old agent has finished: a refused cancel is fine in these engine states. */
const FINISHED = ['done', 'failed', 'cancelled', 'in_review'];
/** Task states with a live agent that can take a note. */
const NOTE_TO = ['queued', 'running', 'needs_human', 'held', 'rate_limited'];

export type ReviewEmit = (event: { type: string; req_id?: string; task_id?: number; payload: Record<string, unknown> }) => void;

type CommentRow = {
  id: number; req_id: string; task_id: number; project: string; file_path: string | null; line: number | null;
  body_md: string; state: ReviewComment['state']; round: number | null; created_at: string; updated_at: string; sent_at: string | null;
};

function toComment(row: CommentRow, attachments: ReviewComment['attachments'] = []): ReviewComment {
  return {
    id: row.id, req_id: row.req_id, task_id: row.task_id, project: row.project, file_path: row.file_path, line: row.line,
    body: row.body_md, state: row.state, round: row.round, created_at: row.created_at, updated_at: row.updated_at, sent_at: row.sent_at,
    attachments,
  };
}

/** The prompt note for one review round; `filesDir` gives the folder of a comment's attached files. */
export function reviewNote(round: number, branch: string | null | undefined, comments: ReviewComment[], filesDir?: (c: ReviewComment) => string): string {
  const where = branch ? `Keep working on \`${branch}\`` : 'Keep working on the same code';
  const items = comments.map((c, i) => {
    const location = c.file_path ? `\`${neutralize(c.file_path)}${c.line ? `:${c.line}` : ''}\`` : 'General';
    const [first, ...rest] = neutralize(c.body).split('\n');
    const files = filesDir ? (c.attachments ?? []).map((a) => `   Attached: \`${neutralize(path.join(filesDir(c), a.name))}\` (${a.type})`) : [];
    return [`${i + 1}. ${location} — ${first}`, ...rest.map((line) => `   ${line}`), ...files].join('\n');
  });
  const attached = filesDir && comments.some((c) => c.attachments?.length) ? ' Files the reviewer attached are listed under their point; open them by path.' : '';
  return `## Review feedback (round ${round})\nA reviewer asked for changes. ${where}: address every point below, commit, and report back for review.${attached}\n\n${items.join('\n')}\n`;
}

/** Reviewer comments, "Request changes" (a new run on the same branch) and notes to running agents. */
export class ReviewService {
  private assist: ReviewAssistService;

  constructor(
    private db: AppDatabase,
    private requirementService: RequirementService,
    private fanOutService: FanOutService,
    private ticketService: TicketService,
    private getAdapter: AdapterFactory,
    private emit?: ReviewEmit,
    assist?: ReviewAssistService
  ) {
    this.assist = assist ?? new ReviewAssistService(db, requirementService);
  }

  /** "Improve with AI": the reviewer's draft rewritten for the agent; nothing is saved. */
  public improveComment(reqId: string, input: ImproveReviewCommentInput): Promise<ImproveReviewCommentResult> {
    return this.assist.improve(reqId, input);
  }

  /** Files changed on a task's branch, for "#" in the comment box. */
  public branchFiles(taskId: number): { branch: string | null; base: string | null; files: string[] } {
    return this.assist.branchFiles(taskId);
  }

  public listComments(reqId: string): ReviewComment[] {
    const rows = this.db
      .prepare('SELECT c.*, t.project FROM review_comments c JOIN bridge_tasks t ON t.id = c.task_id WHERE c.req_id = ? ORDER BY c.id')
      .all(reqId) as CommentRow[];
    return rows.map((row) => toComment(row, listAttachments(this.filesDir(row.req_id, row.id))));
  }

  /** The folder a comment's attached files are kept in. */
  private filesDir(reqId: string, commentId: number): string {
    return path.resolve(this.requirementService.workspaceDir, 'review-attachments', reqId, String(commentId));
  }

  /** The path of one of a comment's attached files (404 when it has no such file). */
  public attachmentFile(commentId: number, name: string): string {
    const comment = this.comment(commentId);
    const file = comment ? attachmentPath(this.filesDir(comment.req_id, comment.id), name) : null;
    if (!file) throw new HttpError(404, `Attachment ${name} not found`);
    return file;
  }

  public addComment(reqId: string, input: CreateReviewCommentInput): ReviewComment {
    const parsed = CreateReviewCommentInputSchema.parse(input);
    if (!this.requirementService.getRequirement(reqId)) throw new HttpError(404, `Requirement ${reqId} not found`);
    const task = this.workTask(parsed.task_id);
    if (!task || task.req_id !== reqId) throw badRequest(`Task #${parsed.task_id} is not a goal or ticket of ${reqId}`);
    if (parsed.line !== undefined && !parsed.file_path) throw badRequest('A line number needs a file path');
    if (parsed.file_path && !isSafeRelativePath(parsed.file_path)) {
      throw badRequest('File path must be relative to the repository (no leading / and no ..)');
    }
    // Every file is decoded before anything is saved, so a broken one leaves no comment behind.
    const files = decodeUploads(parsed.attachments ?? []);
    const now = new Date().toISOString();
    const info = this.db
      .prepare(`
        INSERT INTO review_comments (req_id, task_id, file_path, line, body_md, state, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, 'open', ?, ?)
      `)
      .run(reqId, task.id, parsed.file_path ?? null, parsed.line ?? null, parsed.body, now, now);
    const id = Number(info.lastInsertRowid);
    try {
      writeAttachments(this.filesDir(reqId, id), files);
    } catch (err: any) {
      this.db.prepare('DELETE FROM review_comments WHERE id = ?').run(id);
      fs.rmSync(this.filesDir(reqId, id), { recursive: true, force: true });
      throw new HttpError(500, `Could not save the attached files: ${err?.message || err}`);
    }
    return this.comment(id)!;
  }

  public updateComment(id: number, input: UpdateReviewCommentInput): ReviewComment {
    const parsed = UpdateReviewCommentInputSchema.parse(input);
    const current = this.comment(id);
    if (!current) throw new HttpError(404, `Comment #${id} not found`);
    if (parsed.body !== undefined && current.state !== 'open') throw conflict('Only open comments can be edited');
    this.db
      .prepare('UPDATE review_comments SET body_md = COALESCE(?, body_md), state = COALESCE(?, state), updated_at = ? WHERE id = ?')
      .run(parsed.body ?? null, parsed.state ?? null, new Date().toISOString(), id);
    return this.comment(id)!;
  }

  public deleteComment(id: number): void {
    const current = this.comment(id);
    if (!current) throw new HttpError(404, `Comment #${id} not found`);
    if (current.state !== 'open') throw conflict('Comments already sent to an agent are kept; resolve them instead');
    this.db.prepare('DELETE FROM review_comments WHERE id = ?').run(id);
    fs.rmSync(this.filesDir(current.req_id, id), { recursive: true, force: true });
  }

  /**
   * Send open comments back: each task (in review or done) starts a new run on its branch with a
   * "Review feedback" note. Tasks whose old engine task cannot be stopped, or that were cancelled
   * meanwhile with their requirement, keep their comments open and are reported; the rest
   * proceed. From QA, the requirement returns to in_progress (unless it was cancelled meanwhile).
   */
  public async requestChanges(reqId: string, input: RequestChangesInput = {}): Promise<RequestChangesResult> {
    const parsed = RequestChangesInputSchema.parse(input);
    const req = this.requirementService.getRequirement(reqId);
    if (!req) throw new HttpError(404, `Requirement ${reqId} not found`);
    if (req.status !== 'in_review' && req.status !== 'qa') {
      throw conflict(`${reqId} is ${req.status}; request changes once it is in review or QA`);
    }
    if (req.merge_state === 'running') throw conflict(`A merge of ${reqId} is running; wait for it to finish`);

    const byTask = new Map<number, ReviewComment[]>();
    for (const c of this.listComments(reqId).filter((c) => c.state === 'open')) {
      byTask.set(c.task_id, [...(byTask.get(c.task_id) ?? []), c]);
    }
    const ids = parsed.task_ids?.length ? [...new Set(parsed.task_ids)] : [...byTask.keys()];
    if (ids.length === 0) throw badRequest('Add at least one comment before requesting changes');
    const tasks = ids.map((id) => {
      const task = this.workTask(id);
      if (!task || task.req_id !== reqId) throw badRequest(`Task #${id} is not a goal or ticket of ${reqId}`);
      if (!REVIEWABLE.includes(task.status)) throw conflict(`Task #${id} is ${task.status}; only finished work can be sent back`);
      if (!byTask.has(id)) throw badRequest(`Task #${id} has no open comments`);
      return task;
    });

    const last = this.db.prepare('SELECT MAX(round) AS r FROM review_comments WHERE req_id = ?').get(reqId) as { r: number | null };
    const round = (last.r ?? 0) + 1;
    const results: RequestChangesResult['results'] = [];
    const markSent = this.db.prepare("UPDATE review_comments SET state = 'sent', round = ?, sent_at = ?, updated_at = ? WHERE id = ? AND state = 'open'");

    for (const task of tasks) {
      const comments = byTask.get(task.id)!;
      try {
        await rerunTask(this.db, task, this.getAdapter, {
          from: REVIEWABLE, noteKind: 'review', note: reviewNote(round, task.branch, comments, (c) => this.filesDir(c.req_id, c.id)), stopped: FINISHED, clearMerge: true,
          profile: { model: parsed.model, effort: parsed.effort },
        });
      } catch (err: any) {
        results.push({ taskId: task.id, ok: false, error: err?.message || String(err) });
        continue;
      }
      try {
        if (task.role === 'goal') await this.fanOutService.dispatchGoal(task.id);
        else await this.ticketService.dispatchTicket(task.id);
      } catch {
        // Recorded on the row (failed + last_error); the retry sweep dispatches it again.
      }
      const status = this.workTask(task.id)!.status;
      if (status === 'cancelled') {
        // The requirement was cancelled while the task was being sent back: nothing runs.
        results.push({ taskId: task.id, ok: false, error: 'The requirement was cancelled meanwhile' });
        continue;
      }
      const now = new Date().toISOString();
      for (const c of comments) markSent.run(round, now, now, c.id);
      results.push({ taskId: task.id, ok: true, status });
    }

    const sent = results.filter((r) => r.ok);
    if (sent.length === 0) throw new HttpError(503, `No task could be sent back: ${results[0]?.error ?? 'unknown error'}`);
    if (req.status === 'qa') {
      // Compare-and-set: a requirement cancelled meanwhile stays cancelled.
      this.db.prepare("UPDATE requirements SET status = 'in_progress', updated_at = datetime('now') WHERE id = ? AND status = 'qa'").run(reqId);
    }
    this.requirementService.recalculateDerivedStatus(reqId);
    this.recordEvent('changes_requested', reqId, undefined, {
      reqId, round, taskIds: sent.map((r) => r.taskId),
      comments: sent.reduce((n, r) => n + (byTask.get(r.taskId)?.length ?? 0), 0),
    });
    return { round, results };
  }

  /** Send a person's note to a task whose agent is still working (or waiting). */
  public async sendNote(taskId: number, input: SendTaskNoteInput): Promise<{ ok: true }> {
    const { body } = SendTaskNoteInputSchema.parse(input);
    const task = this.workTask(taskId);
    if (!task) throw new HttpError(404, `Task #${taskId} not found`);
    if (!task.engine_task_id || !NOTE_TO.includes(task.status)) {
      throw conflict(`Task #${taskId} is ${task.status}; notes go to running agents (use Request changes for finished work)`);
    }
    try {
      await this.getAdapter(task.project).appendNote(task.engine_task_id, `## Note from a person\n${neutralize(body)}`);
    } catch (err: any) {
      if (isRateLimit(err)) throw new HttpError(503, `The ${task.project} engine is rate limited; send the note again later`);
      throw new HttpError(502, `Could not send the note to ${task.project}: ${err?.message || err}`);
    }
    this.recordEvent('task_note_sent', task.req_id, task.id, { taskId, reqId: task.req_id, project: task.project, note: oneLine(body, 200) });
    return { ok: true };
  }

  private workTask(id: number): TaskRow | undefined {
    return this.db.prepare("SELECT * FROM bridge_tasks WHERE id = ? AND role IN ('goal', 'ticket')").get(id) as TaskRow | undefined;
  }

  private comment(id: number): ReviewComment | undefined {
    const row = this.db
      .prepare('SELECT c.*, t.project FROM review_comments c JOIN bridge_tasks t ON t.id = c.task_id WHERE c.id = ?')
      .get(id) as CommentRow | undefined;
    return row ? toComment(row, listAttachments(this.filesDir(row.req_id, row.id))) : undefined;
  }

  private recordEvent(type: string, reqId: string, taskId: number | undefined, payload: Record<string, unknown>) {
    this.db
      .prepare('INSERT INTO events (req_id, task_id, type, payload, read, at) VALUES (?, ?, ?, ?, 0, ?)')
      .run(reqId, taskId ?? null, type, JSON.stringify(payload), new Date().toISOString());
    this.emit?.({ type, req_id: reqId, task_id: taskId, payload });
  }
}
