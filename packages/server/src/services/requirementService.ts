import { AppDatabase } from '../db/index.js';
import {
  CreateRequirementInput,
  Requirement,
  RequirementStatus,
  NormStatus,
  AttachmentItem,
} from '@sp-kickstack/shared';
import fs from 'node:fs';
import path from 'node:path';

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
    const seq = this.getNextSeq();
    const id = this.formatId(seq);
    const now = new Date().toISOString();
    const status: RequirementStatus = input.status || 'draft';
    const revision = 1;
    const attachments = input.attachments || [];

    const reqDir = path.join(this.workspaceDir, 'requirements');
    if (!fs.existsSync(reqDir)) {
      fs.mkdirSync(reqDir, { recursive: true });
    }

    const filePath = path.join(reqDir, `${id}.md`);
    const bodyMd = this.renderMarkdown(id, input, status, revision);
    fs.writeFileSync(filePath, bodyMd, 'utf-8');

    const insertTx = this.db.transaction(() => {
      this.db.prepare(`
        INSERT INTO requirements (id, workspace_id, seq, title, status, priority, body_md, file_path, revision, attachments, merge_policy, sprint_id, created_at, updated_at)
        VALUES (@id, @workspace_id, @seq, @title, @status, @priority, @body_md, @file_path, @revision, @attachments, @merge_policy, @sprint_id, @created_at, @updated_at)
      `).run({
        id,
        workspace_id: input.workspace_id || 'default',
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
    });

    insertTx();

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
      affected_projects: projRows.map((p) => p.project),
      attachments: this.parseAttachments(row.attachments),
      merge_policy: row.merge_policy || null,
      sprint_id: row.sprint_id || null,
    };
  }

  public listRequirements(workspaceId?: string): Requirement[] {
    const rows = (
      workspaceId
        ? this.db.prepare('SELECT * FROM requirements WHERE workspace_id = ? ORDER BY seq DESC').all(workspaceId)
        : this.db.prepare('SELECT * FROM requirements ORDER BY seq DESC').all()
    ) as any[];

    return rows.map((row) => {
      const projRows = this.db
        .prepare('SELECT project FROM requirement_projects WHERE req_id = ?')
        .all(row.id) as any[];
      return {
        ...row,
        workspace_id: row.workspace_id || 'default',
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

  public updateRequirementStatus(id: string, status: RequirementStatus): Requirement | null {
    this.updateStatus(id, status);
    return this.getRequirement(id);
  }

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

    if (req.status === 'draft' || req.status === 'cancelled' || req.status === 'qa') {
      return req.status;
    }

    const tasks = this.db
      .prepare("SELECT status, role FROM bridge_tasks WHERE req_id = ? AND role IN ('goal', 'ticket')")
      .all(reqId) as { status: NormStatus; role: string }[];

    if (tasks.length === 0) {
      return req.status;
    }

    const allDone = tasks.every((t) => t.status === 'done' || t.status === 'cancelled');
    if (allDone) {
      this.updateStatus(reqId, 'done');
      return 'done';
    }

    const nonTerminal = tasks.filter((t) => t.status !== 'done' && t.status !== 'cancelled');
    const allInReview = nonTerminal.length > 0 && nonTerminal.every((t) => t.status === 'in_review' || t.status === 'qa');
    if (allInReview) {
      this.updateStatus(reqId, 'in_review');
      return 'in_review';
    }

    this.updateStatus(reqId, 'in_progress');
    return 'in_progress';
  }
}
