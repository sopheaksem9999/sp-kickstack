// Test-only: the Local AI CLI harness wired to the real bridge services (fan-out, watcher, questions).
import type { Requirement } from '@sp-kickstack/shared';
import { createAdapter, type EngineAdapter } from '../adapters/index.js';
import { FanOutService } from '../services/fanOutService.js';
import { LinkService } from '../services/linkService.js';
import { TicketService } from '../services/ticketService.js';
import { TaskReactor } from '../services/taskReactor.js';
import { QuestionService } from '../services/questionService.js';
import { EngineWatcher } from '../watcher/engineWatcher.js';
import { makeLocalHarness, type LocalHarness } from './localEngineFixture.js';

/** Spelled out so declaration emit can name every type. */
export interface LocalE2E extends LocalHarness {
  getAdapter(name: string): EngineAdapter;
  linkService: LinkService;
  tickets: TicketService;
  fanOut: FanOutService;
  reactor: TaskReactor;
  watcher: EngineWatcher;
  questions: QuestionService;
  createRequirement(criteria: string[]): Requirement;
  task(id: number): any;
}

export function makeE2E(): LocalE2E {
  const h = makeLocalHarness();
  const getAdapter = (name: string) => createAdapter(h.projectService.getProject(name)!, { local: h.runner });
  const linkService = new LinkService(h.db, h.projectService, getAdapter);
  const tickets = new TicketService(h.db, h.projectService, linkService, getAdapter);
  const fanOut = new FanOutService(h.db, h.projectService, h.requirementService, getAdapter);
  const reactor = new TaskReactor(h.db, h.requirementService, linkService, () => {});
  const watcher = new EngineWatcher(h.db, h.projectService, h.requirementService, getAdapter, () => {}, 5000, reactor);
  const questions = new QuestionService(h.db, linkService, getAdapter);
  const createRequirement = (criteria: string[]) =>
    h.requirementService.createRequirement({ title: 'Rides', goal: 'Track rides', acceptance_criteria: criteria, affected_projects: ['backend'], priority: 'normal' });
  const task = (id: number) => h.db.prepare('SELECT * FROM bridge_tasks WHERE id = ?').get(id) as any;
  return { ...h, getAdapter, linkService, tickets, fanOut, reactor, watcher, questions, createRequirement, task };
}
