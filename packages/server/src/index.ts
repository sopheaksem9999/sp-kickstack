import path from 'node:path';
import fs from 'node:fs';
import { initDatabase } from './db/index.js';
import { WorkspaceService } from './services/workspaceService.js';
import { ProjectService } from './services/projectService.js';
import { RequirementService } from './services/requirementService.js';
import { SprintService } from './services/sprintService.js';
import { FanOutService } from './services/fanOutService.js';
import { LinkService } from './services/linkService.js';
import { TicketService } from './services/ticketService.js';
import { EngineWatcher } from './watcher/engineWatcher.js';
import { OutboxScanner } from './watcher/outboxScanner.js';
import { SseBroadcaster } from './sse/broadcaster.js';
import { Notifier } from './notify/notifier.js';
import { createAdapter } from './adapters/index.js';
import { VcsSyncService } from './services/vcsSyncService.js';
import { MetricsService } from './services/metricsService.js';
import { createApp } from './api/app.js';
import { TaskReactor } from './services/taskReactor.js';
import { BranchService } from './services/branchService.js';
import { MergeGateService } from './services/mergeGate.js';
import { EngineThrottle } from './lib/engineThrottle.js';
import { RetrySweeper } from './services/retrySweeper.js';
import { QuestionService } from './services/questionService.js';
import { startScheduler } from './services/scheduler.js';

const PORT = Number(process.env.PORT || 4100);
const HOST = process.env.HOST || '127.0.0.1';
const WORKSPACE_DIR = process.env.WORKSPACE_DIR || path.resolve('./workspace');

if (!fs.existsSync(WORKSPACE_DIR)) {
  fs.mkdirSync(WORKSPACE_DIR, { recursive: true });
}

const dbPath = path.join(WORKSPACE_DIR, 'bridge.db');
const db = initDatabase(dbPath);

const workspaceService = new WorkspaceService(db);
const projectService = new ProjectService(db);
const requirementService = new RequirementService(db, WORKSPACE_DIR);
const sprintService = new SprintService(db);

// Per-engine rate-limit handling: circuit breaker + start limit around every adapter call.
const engineThrottle = new EngineThrottle({
  onTrip: (project, until) => {
    const payload = { project, until: new Date(until).toISOString() };
    db.prepare("INSERT INTO events (type, payload, read, at) VALUES ('engine_rate_limited', ?, 0, ?)").run(
      JSON.stringify(payload),
      new Date().toISOString()
    );
    broadcaster.broadcast({ type: 'engine_rate_limited', payload });
  },
});

const getAdapter = engineThrottle.wrap((projectName: string) => {
  const proj = projectService.getProject(projectName);
  if (!proj) throw new Error(`Project ${projectName} not found`);
  return createAdapter(proj);
});

const branchService = new BranchService(db, projectService);
const linkService = new LinkService(db, projectService, getAdapter);
const ticketService = new TicketService(db, projectService, linkService, getAdapter, branchService);
const fanOutService = new FanOutService(db, projectService, requirementService, getAdapter, branchService);
const broadcaster = new SseBroadcaster();
const questionService = new QuestionService(db, linkService, getAdapter, (evt) => broadcaster.broadcast(evt));
const notifier = new Notifier();
const reactor = new TaskReactor(db, requirementService, linkService, (evt) => broadcaster.broadcast(evt));
const mergeGate = new MergeGateService(db, projectService, requirementService, reactor, { getAdapter });
// Auto-merge policy: start the merge gate when all of a requirement's work is in review.
reactor.setHooks({ onRequirementInReview: (id) => mergeGate.autoStart(id) });
mergeGate.resetInterrupted();
const vcsSyncService = new VcsSyncService(
  db,
  projectService,
  requirementService,
  linkService,
  broadcaster,
  reactor
);
const metricsService = new MetricsService(db, sprintService);

const watcher = new EngineWatcher(
  db,
  projectService,
  requirementService,
  getAdapter,
  (evt) => broadcaster.broadcast(evt),
  5000,
  reactor
);

const outboxScanner = new OutboxScanner(projectService, ticketService);
const retrySweeper = new RetrySweeper(db, fanOutService, ticketService, linkService, { throttle: engineThrottle });
const TICK_MS = Number(process.env.WATCH_INTERVAL_MS) || 5000;

// Seed from projects.yaml if present
const yamlPath = path.join(WORKSPACE_DIR, 'projects.yaml');
if (fs.existsSync(yamlPath)) {
  const yamlContent = fs.readFileSync(yamlPath, 'utf-8');
  projectService.seedFromYaml(yamlContent);
}

const app = createApp({
  db,
  workspaceService,
  projectService,
  requirementService,
  sprintService,
  vcsSyncService,
  metricsService,
  fanOutService,
  linkService,
  ticketService,
  broadcaster,
  notifier,
  reactor,
  mergeGate,
  getAdapter,
  questionService,
  demoMode: process.env.DEMO_MODE === '1',
  agentToken: process.env.AGENT_TOKEN || undefined,
  webhookSecret: process.env.GITHUB_WEBHOOK_SECRET || undefined,
});

const server = app.listen(PORT, HOST, () => {
  console.log(`🚀 SP Kickstack DevFlow Bridge running at http://${HOST}:${PORT}`);
  // Each tick starts every job that is not still running: sync engine state, retry failed
  // side effects (also recovers reservations left pending by a crash), pick up outbox tickets.
  // A slow job never delays the others.
  startScheduler(
    [
      ['watcher', () => watcher.scanOnce()],
      ['retry', () => retrySweeper.sweepOnce()],
      ['outbox', () => outboxScanner.scanOnce()],
    ],
    TICK_MS
  );
});

export { app, server };
