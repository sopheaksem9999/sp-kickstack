import fs from 'node:fs';
import path from 'node:path';
import { ProjectService } from '../services/projectService.js';
import { TicketService } from '../services/ticketService.js';
import { CreateTicketInputSchema } from '@sp-kickstack/shared';

export class OutboxScanner {
  constructor(
    private projectService: ProjectService,
    private ticketService: TicketService
  ) {}

  public async scanOnce(): Promise<number> {
    const projects = this.projectService.listProjects();
    let processed = 0;

    for (const project of projects) {
      if (!project.enabled) continue;
      const outboxDir = path.join(project.repo_path, '.devflow', 'outbox');

      if (!fs.existsSync(outboxDir)) continue;

      const files = fs.readdirSync(outboxDir).filter((f) => f.endsWith('.json'));

      for (const file of files) {
        const filePath = path.join(outboxDir, file);
        try {
          const raw = fs.readFileSync(filePath, 'utf-8');
          const data = JSON.parse(raw);
          const validated = CreateTicketInputSchema.parse(data);

          const sourceProject = data.project || project.name;
          const sourceTaskId = data.engineTaskId || data.taskId;

          await this.ticketService.createTicket(validated, sourceProject, sourceTaskId);

          // Archive or remove
          const processedDir = path.join(outboxDir, 'processed');
          if (!fs.existsSync(processedDir)) {
            fs.mkdirSync(processedDir, { recursive: true });
          }
          fs.renameSync(filePath, path.join(processedDir, file));
          processed++;
        } catch (err: any) {
          // If invalid or error, leave or log
        }
      }
    }

    return processed;
  }
}
