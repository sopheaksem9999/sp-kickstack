import fs from 'node:fs';
import path from 'node:path';
import { ProjectService } from '../services/projectService.js';
import { TicketService } from '../services/ticketService.js';
import type { QuestionService } from '../services/questionService.js';
import { AskQuestionInputSchema, CreateTicketInputSchema } from '@sp-kickstack/shared';

type OutboxKind = 'question' | 'ticket';

/** Errors that will fail the same way on every retry (bad input, unknown target, limits). */
function isPermanent(err: any): boolean {
  const status = err?.status;
  return Array.isArray(err?.issues) || status === 400 || status === 404 || status === 409 || status === 429;
}

export class OutboxScanner {
  private isScanning = false;

  constructor(
    private projectService: ProjectService,
    private ticketService: TicketService,
    private questionService?: QuestionService
  ) {}

  public async scanOnce(): Promise<number> {
    if (this.isScanning) return 0;
    this.isScanning = true;
    try {
      return await this.scanAll();
    } finally {
      this.isScanning = false;
    }
  }

  private async scanAll(): Promise<number> {
    const projects = this.projectService.listProjects();
    let processed = 0;

    for (const project of projects) {
      if (!project.enabled) continue;
      const outboxDir = path.join(project.repo_path, '.devflow', 'outbox');

      if (!fs.existsSync(outboxDir)) continue;

      const files = fs.readdirSync(outboxDir).filter((f) => f.endsWith('.json'));

      for (const file of files) {
        const filePath = path.join(outboxDir, file);
        // xticket names question files question-*.json; the file's own kind wins once it parses.
        let kind: OutboxKind = file.startsWith('question-') ? 'question' : 'ticket';
        try {
          const data = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
          kind = data?.kind === 'question' ? 'question' : 'ticket';
          const sourceProject = data.project || project.name;
          const sourceTaskId = data.engineTaskId || data.taskId;

          if (kind === 'question') {
            if (!this.questionService) throw Object.assign(new Error('This bridge does not take questions'), { status: 400 });
            // Idempotent: a re-scan returns the same question.
            await this.questionService.ask(AskQuestionInputSchema.parse(data), sourceProject, sourceTaskId);
          } else {
            // Idempotent: a re-scan after a partial failure returns the same ticket.
            await this.ticketService.createTicket(CreateTicketInputSchema.parse(data), sourceProject, sourceTaskId);
          }

          this.moveTo(outboxDir, 'processed', file);
          processed++;
        } catch (err: any) {
          if (err instanceof SyntaxError || isPermanent(err)) {
            this.reject(outboxDir, file, project.name, kind, err);
          }
          // Otherwise transient (engine down, hold failed): leave the file for the next scan.
        }
      }
    }

    return processed;
  }

  private moveTo(outboxDir: string, folder: 'processed' | 'failed', file: string) {
    const target = path.join(outboxDir, folder);
    fs.mkdirSync(target, { recursive: true });
    fs.renameSync(path.join(outboxDir, file), path.join(target, file));
  }

  private reject(outboxDir: string, file: string, projectName: string, kind: OutboxKind, err: any) {
    const reason = Array.isArray(err?.issues)
      ? err.issues.map((i: any) => `${i.path.join('.') || 'field'}: ${i.message}`).join('; ')
      : err?.message || String(err);
    this.moveTo(outboxDir, 'failed', file);
    fs.writeFileSync(path.join(outboxDir, 'failed', `${file}.error.txt`), `${reason}\n`, 'utf-8');
    this.ticketService.recordEvent('ticket_rejected', null, null, { project: projectName, file, kind, reason });
  }
}
