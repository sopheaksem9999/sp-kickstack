import { AppDatabase } from '../db/index.js';
import {
  CreateRequirementInput,
  Requirement,
  RequirementStatus,
  NormStatus,
  AttachmentItem,
} from '@sp-kickstack/shared';
import { HttpError, conflict } from '../lib/httpError.js';
import fs from 'node:fs';
import path from 'node:path';

const OPERATOR_OWNED_STATUSES: RequirementStatus[] = ['draft', 'ready', 'qa', 'done', 'cancelled'];
const TERMINAL_TASK_STATUSES: NormStatus[] = ['done', 'cancelled', 'failed'];

export class RequirementService {
  constructor(
    private db: AppDatabase,
    private workspaceDir: string = './workspace'
  ) {}

  public getNextSeq(): number {
    const row = this.db.prepare('SELECT MAX(seq) as maxSeq FROM requirements').get() as any;
    return (row?.maxSeq || 0) + 1;
  }

  public formatId(seq: number): string {
    return `REQ-${String(seq).padStart(3, '0')}`;
  }

  public renderMarkdown(
    id: string,
    input: CreateRequirementInput,
    status: RequirementStatus = 'draft',
    revision: number = 1
  ): string {
    const list = input.acceptance_criteria && input.acceptance_criteria.length > 0
      ? input.acceptance_criteria
      : ['Implementation complete and verified with tests'];
    const criteria = list.map((c) => `- [ ] ${c}`).join('\n');
    let md = `---
id: ${id}
title: ${input.title}
priority: ${input.priority}
projects: [${input.affected_projects.join(', ')}]
status: ${status}
revision: ${revision}
---

## Goal
${input.goal}

${input.user_story ? `## User story\n${input.user_story}\n` : ''}
## Acceptance criteria
${criteria}

${input.api_hints ? `## API hints\n${input.api_hints}\n` : ''}
${input.notes ? `## Notes / links\n${input.notes}\n` : ''}`;

    if (input.attachments && input.attachments.length > 0) {
      md += `\n## Attachments\n${input.attachments
        .map(
          (a) =>
            `- 📎 **${a.name}** (${a.size ? Math.round(a.size / 1024) + ' KB' : 'file'}${
              a.type ? ', ' + a.type : ''
            })`
        )
        .join('\n')}\n`;
    }

    return md;
  }

  public createRequirement(input: CreateRequirementInput): Requirement {
    const now = new Date().toISOString();
    const status: RequirementStatus = input.status || 'draft';
    const revision = 1;
    const attachments = input.attachments || [];
    const reqDir = path.join(this.workspaceDir, 'requirements');

    // Allocate the sequence number and insert in one IMMEDIATE transaction:
    // the MCP server process writes to the same database.
    const insertTx = this.db.transaction(() => {
      const seq = this.getNextSeq();
      const id = this.formatId(seq);
      const filePath = path.join(reqDir, `${id}.md`);
      const bodyMd = this.renderMarkdown(id, input, status, revision);

      this.db.prepare(`
        INSERT INTO requirements (id, workspace_id, session_id, seq, title, status, priority, body_md, file_path, revision, attachments, merge_policy, sprint_id, created_at, updated_at)
        VALUES (@id, @workspace_id, @session_id, @seq, @title, @status, @priority, @body_md, @file_path, @revision, @attachments, @merge_policy, @sprint_id, @created_at, @updated_at)
      `).run({
        id,
        workspace_id: input.workspace_id || 'default',
        session_id: input.session_id || null,
        seq,
        title: input.title,
        status,
        priority: input.priority || 'normal',
        body_md: bodyMd,
        file_path: filePath,
        revision,
        attachments: JSON.stringify(attachments),
        merge_policy: input.merge_policy || null,
        sprint_id: input.sprint_id || null,
        created_at: now,
        updated_at: now,
      });

      const insertProj = this.db.prepare(`
        INSERT INTO requirement_projects (req_id, project) VALUES (?, ?)
      `);
      for (const proj of input.affected_projects) {
        insertProj.run(id, proj);
      }

      return { id, filePath, bodyMd };
    });

    const { id, filePath, bodyMd } = insertTx.immediate();

    // Write the markdown copy only after the row is committed, atomically via rename.
    if (!fs.existsSync(reqDir)) {
      fs.mkdirSync(reqDir, { recursive: true });
    }
    const tmpPath = `${filePath}.${process.pid}.tmp`;
    fs.writeFileSync(tmpPath, bodyMd, 'utf-8');
    fs.renameSync(tmpPath, filePath);

    return this.getRequirement(id)!;
  }

  private parseAttachments(raw?: string): AttachmentItem[] {
    if (!raw) return [];
    try {
      return JSON.parse(raw);
    } catch {
      return [];
    }
  }

  public getRequirement(id: string): Requirement | null {
    const row = this.db.prepare('SELECT * FROM requirements WHERE id = ?').get(id) as any;
    if (!row) return null;

    const projRows = this.db
      .prepare('SELECT project FROM requirement_projects WHERE req_id = ?')
      .all(id) as any[];

    return {
      ...row,
      workspace_id: row.workspace_id || 'default',
      session_id: row.session_id || null,
      affected_projects: projRows.map((p) => p.project),
      attachments: this.parseAttachments(row.attachments),
      merge_policy: row.merge_policy || null,
      sprint_id: row.sprint_id || null,
    };
  }

  public listRequirements(workspaceId?: string, sessionId?: string): Requirement[] {
    let query = 'SELECT * FROM requirements';
    const params: any[] = [];
    if (workspaceId && sessionId) {
      query += ' WHERE workspace_id = ? AND session_id = ? ORDER BY seq DESC';
      params.push(workspaceId, sessionId);
    } else if (workspaceId) {
      query += ' WHERE workspace_id = ? ORDER BY seq DESC';
      params.push(workspaceId);
    } else if (sessionId) {
      query += ' WHERE session_id = ? ORDER BY seq DESC';
      params.push(sessionId);
    } else {
      query += ' ORDER BY seq DESC';
    }

    const rows = this.db.prepare(query).all(...params) as any[];

    return rows.map((row) => {
      const projRows = this.db
        .prepare('SELECT project FROM requirement_projects WHERE req_id = ?')
        .all(row.id) as any[];
      return {
        ...row,
        workspace_id: row.workspace_id || 'default',
        session_id: row.session_id || null,
        affected_projects: projRows.map((p) => p.project),
        attachments: this.parseAttachments(row.attachments),
        merge_policy: row.merge_policy || null,
        sprint_id: row.sprint_id || null,
      };
    });
  }

  public updateRequirementSprint(id: string, sprintId: string | null): Requirement {
    this.db
      .prepare("UPDATE requirements SET sprint_id = ?, updated_at = datetime('now') WHERE id = ?")
      .run(sprintId, id);
    const req = this.getRequirement(id);
    if (!req) throw new Error(`Requirement ${id} not found`);
    return req;
  }

  public updateRequirementProjects(id: string, projects: string[]): Requirement | null {
    const req = this.getRequirement(id);
    if (!req) throw new Error(`Requirement ${id} not found`);

    const updateTx = this.db.transaction(() => {
      this.db.prepare('DELETE FROM requirement_projects WHERE req_id = ?').run(id);
      const insertProj = this.db.prepare('INSERT INTO requirement_projects (req_id, project) VALUES (?, ?)');
      for (const proj of projects) {
        insertProj.run(id, proj);
      }
      this.db.prepare("UPDATE requirements SET updated_at = datetime('now') WHERE id = ?").run(id);
    });
    updateTx();

    return this.getRequirement(id);
  }

  public updateRequirementMergePolicy(id: string, mergePolicy: any): Requirement | null {
    const req = this.getRequirement(id);
    if (!req) throw new Error(`Requirement ${id} not found`);

    this.db.prepare("UPDATE requirements SET merge_policy = ?, updated_at = datetime('now') WHERE id = ?").run(mergePolicy || null, id);
    return this.getRequirement(id);
  }

  public updateStatus(id: string, status: RequirementStatus) {
    this.db.prepare(`
      UPDATE requirements SET status = ?, updated_at = datetime('now') WHERE id = ?
    `).run(status, id);
  }

  /**
   * Operator-driven status change (Kanban drag, status select). A requirement with no
   * dispatched tasks moves freely; once dispatched, the board follows the engines: only
   * qa, and done when no task is still active, can be set by hand.
   */
  public updateRequirementStatus(id: string, status: RequirementStatus): Requirement | null {
    const req = this.getRequirement(id);
    if (!req) return null;
    if (req.status === status) return req;

    const tasks = this.db
      .prepare("SELECT status FROM bridge_tasks WHERE req_id = ? AND role IN ('goal', 'ticket')")
      .all(id) as { status: NormStatus }[];

    if (tasks.length > 0) {
      if (req.status === 'cancelled') {
        throw conflict(`${id} was cancelled after dispatch; create a new requirement instead of reopening it`);
      }
      // Leaving QA for work statuses hands control back to task progress.
      if (req.status === 'qa' && (status === 'in_progress' || status === 'in_review')) {
        this.updateStatus(id, 'in_progress');
        this.recalculateDerivedStatus(id);
        return this.getRequirement(id);
      }
      const active = tasks.filter((t) => !TERMINAL_TASK_STATUSES.includes(t.status));
      if (status === 'done' && active.length > 0) {
        throw conflict(`${active.length} task(s) are still active; finish or cancel them before marking ${id} done`);
      }
      if (status !== 'qa' && status !== 'done') {
        throw conflict(`"${status}" is set automatically from task progress once ${id} is dispatched`);
      }
    }

    this.updateStatus(id, status);
    return this.getRequirement(id);
  }

  /**
   * Operator confirms the reviewed work was merged (the bridge itself runs no git
   * command). Allowed only when every goal/ticket task is in review or done.
   */
  public confirmMerged(id: string): { ok: boolean; status: string; merged_branch: null; git_operation: false } {
    const req = this.getRequirement(id);
    if (!req) throw new HttpError(404, `Requirement ${id} not found`);
    if (req.status === 'cancelled' || req.status === 'done' || req.status === 'draft') {
      throw conflict(`${id} is ${req.status}; only dispatched, open requirements can be confirmed merged`);
    }

    const tasks = this.db
      .prepare("SELECT status FROM bridge_tasks WHERE req_id = ? AND role IN ('goal', 'ticket') AND status <> 'cancelled'")
      .all(id) as { status: NormStatus }[];
    if (tasks.length === 0) {
      throw conflict(`${id} has no dispatched work to confirm`);
    }
    const open = tasks.filter((t) => t.status !== 'in_review' && t.status !== 'done');
    if (open.length > 0) {
      throw conflict(`${open.length} task(s) of ${id} are not in review or done yet`);
    }

    this.updateStatus(id, 'done');
    this.db
      .prepare("INSERT INTO events (req_id, type, payload, read, at) VALUES (?, 'merge_confirmed', ?, 0, ?)")
      .run(id, JSON.stringify({ req_id: id, action: 'operator_confirmed', git_operation: false }), new Date().toISOString());

    return { ok: true, status: 'done', merged_branch: null, git_operation: false };
  }

  /** DEMO_MODE only: marks the requirement done as if merged; no git operation happens. */
  public mergeRequirementToMain(id: string): { ok: boolean; status: string; merged_branch: string } {
    const req = this.getRequirement(id);
    if (!req) throw new Error(`Requirement ${id} not found`);

    // Complete the merge into main branch
    this.updateStatus(id, 'done');

    // Record event
    this.db.prepare(`
      INSERT INTO events (req_id, type, payload, read, at)
      VALUES (?, 'merge_ready', ?, 0, datetime('now'))
    `).run(
      id,
      JSON.stringify({
        req_id: id,
        source_branch: 'develop',
        target_branch: 'main',
        action: 'human_reviewed_and_merged',
      })
    );

    return {
      ok: true,
      status: 'done',
      merged_branch: 'main',
    };
  }

  public recalculateDerivedStatus(reqId: string): RequirementStatus {
    const req = this.getRequirement(reqId);
    if (!req) throw new Error(`Requirement ${reqId} not found`);

    // Set by people (or by fan-out for ready -> in_progress); never recomputed away.
    if (OPERATOR_OWNED_STATUSES.includes(req.status)) {
      return req.status;
    }

    const tasks = this.db
      .prepare("SELECT status, role FROM bridge_tasks WHERE req_id = ? AND role IN ('goal', 'ticket') AND status <> 'cancelled'")
      .all(reqId) as { status: NormStatus; role: string }[];

    if (tasks.length === 0) {
      return req.status;
    }

    if (tasks.every((t) => t.status === 'done')) {
      this.updateStatus(reqId, 'done');
      return 'done';
    }

    const nonTerminal = tasks.filter((t) => t.status !== 'done');
    const allInReview = nonTerminal.every((t) => t.status === 'in_review' || t.status === 'qa');
    if (allInReview) {
      this.updateStatus(reqId, 'in_review');
      return 'in_review';
    }

    this.updateStatus(reqId, 'in_progress');
    return 'in_progress';
  }
}
