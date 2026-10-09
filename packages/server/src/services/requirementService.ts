import { AppDatabase } from '../db/index.js';
import {
  CreateRequirementInput,
  Requirement,
  RequirementStatus,
  NormStatus,
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
    const criteria = input.acceptance_criteria.map((c) => `- [ ] ${c}`).join('\n');
    return `---
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
${input.notes ? `## Notes / links\n${input.notes}\n` : ''}
`;
  }

  public createRequirement(input: CreateRequirementInput): Requirement {
    const seq = this.getNextSeq();
    const id = this.formatId(seq);
    const now = new Date().toISOString();
    const status: RequirementStatus = 'draft';
    const revision = 1;

    const reqDir = path.join(this.workspaceDir, 'requirements');
    if (!fs.existsSync(reqDir)) {
      fs.mkdirSync(reqDir, { recursive: true });
    }

    const filePath = path.join(reqDir, `${id}.md`);
    const bodyMd = this.renderMarkdown(id, input, status, revision);
    fs.writeFileSync(filePath, bodyMd, 'utf-8');

    const insertTx = this.db.transaction(() => {
      this.db.prepare(`
        INSERT INTO requirements (id, seq, title, status, priority, body_md, file_path, revision, created_at, updated_at)
        VALUES (@id, @seq, @title, @status, @priority, @body_md, @file_path, @revision, @created_at, @updated_at)
      `).run({
        id,
        seq,
        title: input.title,
        status,
        priority: input.priority || 'normal',
        body_md: bodyMd,
        file_path: filePath,
        revision,
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

  public getRequirement(id: string): Requirement | null {
    const row = this.db.prepare('SELECT * FROM requirements WHERE id = ?').get(id) as any;
    if (!row) return null;

    const projRows = this.db
      .prepare('SELECT project FROM requirement_projects WHERE req_id = ?')
      .all(id) as any[];

    return {
      ...row,
      affected_projects: projRows.map((p) => p.project),
    };
  }

  public listRequirements(): Requirement[] {
    const rows = this.db.prepare('SELECT * FROM requirements ORDER BY seq DESC').all() as any[];
    return rows.map((row) => {
      const projRows = this.db
        .prepare('SELECT project FROM requirement_projects WHERE req_id = ?')
        .all(row.id) as any[];
      return {
        ...row,
        affected_projects: projRows.map((p) => p.project),
      };
    });
  }

  public updateStatus(id: string, status: RequirementStatus) {
    this.db.prepare(`
      UPDATE requirements SET status = ?, updated_at = datetime('now') WHERE id = ?
    `).run(status, id);
  }

  public recalculateDerivedStatus(reqId: string): RequirementStatus {
    const req = this.getRequirement(reqId);
    if (!req) throw new Error(`Requirement ${reqId} not found`);

    if (req.status === 'draft' || req.status === 'cancelled') {
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
    const allInReview = nonTerminal.length > 0 && nonTerminal.every((t) => t.status === 'in_review');
    if (allInReview) {
      this.updateStatus(reqId, 'in_review');
      return 'in_review';
    }

    this.updateStatus(reqId, 'in_progress');
    return 'in_progress';
  }
}
