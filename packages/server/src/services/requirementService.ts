import { AppDatabase } from '../db/index.js';
import {
  CreateRequirementInput,
  UpdateRequirementInput,
  Requirement,
  RequirementStatus,
  NormStatus,
  AttachmentItem,
  AgentProfileInput,
  AgentProfileInputSchema,
  UpdateRunSettingsInput,
  UpdateRunSettingsInputSchema,
} from '@sp-kickstack/shared';
import { HttpError, badRequest, conflict } from '../lib/httpError.js';
import { targetBranchProblem } from './branchService.js';
import { SettingsService } from './settingsService.js';
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
${input.notes ? `## Specification & Architectural Details\n${input.notes}\n` : ''}`;

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
    const scoped = { ...input, affected_projects: this.ownWorkspaceProjects(input.workspace_id || 'default', input.affected_projects) };
    // Not named (undefined): Settings → default target branch; null or '' = each repository's base branch.
    const fromSettings = input.target_branch === undefined;
    const targetBranch =
      (fromSettings ? new SettingsService(this.db).getBranchMergeSettings().default_target_branch : input.target_branch)?.trim() || null;
    if (targetBranch) {
      this.assertTargetBranch(targetBranch, scoped.affected_projects, fromSettings ? ' (Settings → Git & Branch Rules → Default target branch)' : '');
    }
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
      const bodyMd = this.renderMarkdown(id, scoped, status, revision);

      this.db.prepare(`
        INSERT INTO requirements (id, workspace_id, session_id, seq, title, status, priority, body_md, file_path, revision, attachments, merge_policy, target_branch, sprint_id, created_at, updated_at)
        VALUES (@id, @workspace_id, @session_id, @seq, @title, @status, @priority, @body_md, @file_path, @revision, @attachments, @merge_policy, @target_branch, @sprint_id, @created_at, @updated_at)
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
        target_branch: targetBranch,
        sprint_id: input.sprint_id || null,
        created_at: now,
        updated_at: now,
      });

      const insertProj = this.db.prepare(`
        INSERT INTO requirement_projects (req_id, project) VALUES (?, ?)
      `);
      for (const proj of scoped.affected_projects) {
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
      agent_model: row.agent_model ?? null,
      agent_effort: row.agent_effort ?? null,
      agent_cli: row.agent_cli ?? null,
      target_branch: row.target_branch ?? null,
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

  public updateRequirement(id: string, input: UpdateRequirementInput): Requirement {
    const existing = this.getRequirement(id);
    if (!existing) throw new Error(`Requirement ${id} not found`);

    if (existing.status !== 'draft' && existing.status !== 'ready') {
      throw new HttpError(
        400,
        `Cannot edit requirement in status "${existing.status}". Only ToDo and Ready for Dispatch stages can be edited.`
      );
    }

    const updateTx = this.db.transaction(() => {
      if (input.title !== undefined) {
        this.db
          .prepare("UPDATE requirements SET title = ?, updated_at = datetime('now') WHERE id = ?")
          .run(input.title, id);
      }
      if (input.body_md !== undefined) {
        this.db
          .prepare("UPDATE requirements SET body_md = ?, updated_at = datetime('now') WHERE id = ?")
          .run(input.body_md, id);
        const reqDir = path.join(this.workspaceDir, '.bridge', 'requirements');
        const filePath = path.join(reqDir, `${id}.md`);
        try {
          fs.writeFileSync(filePath, input.body_md, 'utf-8');
        } catch {}
      }
      if (input.priority !== undefined) {
        this.db
          .prepare("UPDATE requirements SET priority = ?, updated_at = datetime('now') WHERE id = ?")
          .run(input.priority, id);
      }
      if (input.sprint_id !== undefined) {
        this.db
          .prepare("UPDATE requirements SET sprint_id = ?, updated_at = datetime('now') WHERE id = ?")
          .run(input.sprint_id, id);
      }
      if (input.merge_policy !== undefined) {
        this.db
          .prepare("UPDATE requirements SET merge_policy = ?, updated_at = datetime('now') WHERE id = ?")
          .run(input.merge_policy, id);
      }
      if (input.affected_projects && input.affected_projects.length > 0) {
        this.db.prepare('DELETE FROM requirement_projects WHERE req_id = ?').run(id);
        const insertProj = this.db.prepare(
          'INSERT INTO requirement_projects (req_id, project) VALUES (?, ?)'
        );
        for (const proj of input.affected_projects) {
          insertProj.run(id, proj);
        }
        this.db
          .prepare("UPDATE requirements SET updated_at = datetime('now') WHERE id = ?")
          .run(id);
      }
    });
    updateTx();

    return this.getRequirement(id)!;
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
    const scoped = this.ownWorkspaceProjects(req.workspace_id || 'default', projects);

    const updateTx = this.db.transaction(() => {
      this.db.prepare('DELETE FROM requirement_projects WHERE req_id = ?').run(id);
      const insertProj = this.db.prepare('INSERT INTO requirement_projects (req_id, project) VALUES (?, ?)');
      for (const proj of scoped) {
        insertProj.run(id, proj);
      }
      this.db.prepare("UPDATE requirements SET updated_at = datetime('now') WHERE id = ?").run(id);
    });
    updateTx();

    return this.getRequirement(id);
  }

  /**
   * A requirement targets repositories of its own workspace only: names registered to another
   * workspace are dropped (AI suggestions can include them). Refuses when every chosen
   * repository belongs to another workspace.
   */
  private ownWorkspaceProjects(workspaceId: string, projects: string[]): string[] {
    const rows = this.db.prepare('SELECT name, workspace_id FROM projects').all() as Array<{ name: string; workspace_id: string | null }>;
    const workspaceOf = new Map(rows.map((r) => [r.name, r.workspace_id || 'default']));
    const kept = projects.filter((p) => !workspaceOf.has(p) || workspaceOf.get(p) === workspaceId);
    if (projects.length > 0 && kept.length === 0) {
      const own = rows.filter((r) => (r.workspace_id || 'default') === workspaceId).map((r) => r.name).sort();
      throw badRequest(
        `${projects.join(', ')} ${projects.length === 1 ? 'belongs' : 'belong'} to another workspace. ` +
          (own.length > 0 ? `Pick from this workspace's repositories: ${own.join(', ')}.` : 'Register a project in this workspace first.')
      );
    }
    return kept;
  }

  public updateRequirementMergePolicy(id: string, mergePolicy: any): Requirement | null {
    const req = this.getRequirement(id);
    if (!req) throw new Error(`Requirement ${id} not found`);

    this.db.prepare("UPDATE requirements SET merge_policy = ?, updated_at = datetime('now') WHERE id = ?").run(mergePolicy || null, id);
    return this.getRequirement(id);
  }

  /** Agent model / effort for this requirement's runs: undefined keeps a value, null clears it. */
  public updateAgentProfile(id: string, input: AgentProfileInput): Requirement {
    const parsed = AgentProfileInputSchema.parse(input ?? {});
    const req = this.getRequirement(id);
    if (!req) throw new HttpError(404, `Requirement ${id} not found`);
    const model = parsed.model === undefined ? req.agent_model ?? null : parsed.model;
    const effort = parsed.effort === undefined ? req.agent_effort ?? null : parsed.effort;
    this.db
      .prepare("UPDATE requirements SET agent_model = ?, agent_effort = ?, updated_at = datetime('now') WHERE id = ?")
      .run(model, effort, id);
    return this.getRequirement(id)!;
  }

  /**
   * CLI, model, effort, target branch and merge policy for this requirement's runs: undefined keeps a
   * value, null clears it. Editable until the requirement is done or cancelled; the target branch only
   * until fan-out, because tasks were branched from it.
   */
  public updateRunSettings(id: string, input: UpdateRunSettingsInput): Requirement {
    const parsed = UpdateRunSettingsInputSchema.parse(input ?? {});
    const req = this.getRequirement(id);
    if (!req) throw new HttpError(404, `Requirement ${id} not found`);
    if (req.status === 'done' || req.status === 'cancelled') {
      throw conflict(`${id} is ${req.status}; its run settings can no longer change`);
    }

    const current = req.target_branch ?? null;
    const target = parsed.target_branch === undefined ? current : parsed.target_branch || null;
    if (target !== current) {
      const fannedOut = this.db.prepare("SELECT 1 FROM bridge_tasks WHERE req_id = ? AND role IN ('goal', 'ticket') LIMIT 1").get(id);
      if (fannedOut) {
        throw conflict(
          `${id} was already fanned out to ${current ?? "each repository's base branch"}; the target branch cannot change (create a new requirement for another branch)`
        );
      }
      if (target) this.assertTargetBranch(target, req.affected_projects);
    }

    const keep = <T>(next: T | null | undefined, value: T | null | undefined) => (next === undefined ? value ?? null : next);
    this.db
      .prepare(`
        UPDATE requirements
        SET agent_cli = ?, agent_model = ?, agent_effort = ?, target_branch = ?, merge_policy = ?, updated_at = datetime('now')
        WHERE id = ?
      `)
      .run(
        keep(parsed.agent_cli, req.agent_cli), keep(parsed.agent_model, req.agent_model), keep(parsed.agent_effort, req.agent_effort),
        target, keep(parsed.merge_policy, req.merge_policy), id
      );
    return this.getRequirement(id)!;
  }

  /** 400 when `target` cannot be the target branch of a requirement in these repositories. */
  private assertTargetBranch(target: string, projectNames: string[], source = '') {
    const repos = projectNames.length
      ? (this.db
          .prepare(`SELECT name, repo_path FROM projects WHERE name IN (${projectNames.map(() => '?').join(', ')})`)
          .all(...projectNames) as Array<{ name: string; repo_path: string }>)
      : [];
    const problem = targetBranchProblem(this.db, target, repos);
    if (problem) throw badRequest(problem + source);
  }

  public updateStatus(id: string, status: RequirementStatus) {
    this.db.prepare(`
      UPDATE requirements SET status = ?, updated_at = datetime('now') WHERE id = ?
    `).run(status, id);
    // A finished requirement takes no more answers: close its open agent questions.
    if (status === 'done') {
      this.db
        .prepare("UPDATE bridge_tasks SET status = 'cancelled', updated_at = ? WHERE req_id = ? AND role = 'question' AND status = 'needs_human'")
        .run(new Date().toISOString(), id);
      this.db
        .prepare(`
          UPDATE links SET state = 'cancelled'
          WHERE state = 'waiting' AND depends_on_id IN (SELECT id FROM bridge_tasks WHERE req_id = ? AND role = 'question')
        `)
        .run(id);
    }
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
      if (status === 'qa' && this.hasUnmergedBranches(id)) {
        throw conflict(`${id} has unmerged task branches; use "Merge & move to QA" so they are merged first`);
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
    if (this.hasUnmergedBranches(id)) {
      throw conflict(`${id} has unmerged task branches; use "Merge & move to QA" instead of confirming`);
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

  /** Branched goal/ticket work that the merge gate has not handled yet. */
  public hasUnmergedBranches(id: string): boolean {
    return Boolean(
      this.db
        .prepare(`
          SELECT 1 FROM bridge_tasks
          WHERE req_id = ? AND role IN ('goal', 'ticket') AND status <> 'cancelled'
            AND branch IS NOT NULL AND merged_at IS NULL
          LIMIT 1
        `)
        .get(id)
    );
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
      // Branched work is only finished once the merge gate merged it.
      const finished: RequirementStatus = this.hasUnmergedBranches(reqId) ? 'in_review' : 'done';
      this.updateStatus(reqId, finished);
      return finished;
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
