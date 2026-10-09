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

const getAdapter = (projectName: string) => {
  const proj = projectService.getProject(projectName);
  if (!proj) throw new Error(`Project ${projectName} not found`);
  return createAdapter(proj);
};

const linkService = new LinkService(db, projectService, getAdapter);
const ticketService = new TicketService(db, projectService, linkService, getAdapter);
const fanOutService = new FanOutService(db, projectService, requirementService, getAdapter);
const broadcaster = new SseBroadcaster();
const notifier = new Notifier();
const vcsSyncService = new VcsSyncService(
  db,
  projectService,
  requirementService,
  linkService,
  broadcaster
);
const metricsService = new MetricsService(db, sprintService);

const watcher = new EngineWatcher(
  db,
  projectService,
  requirementService,
  getAdapter,
  (evt) => broadcaster.broadcast(evt)
);

const outboxScanner = new OutboxScanner(projectService, ticketService);

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
});

const server = app.listen(PORT, HOST, () => {
  console.log(`🚀 SP Kickstack DevFlow Bridge running at http://${HOST}:${PORT}`);
  watcher.start();
  setInterval(() => {
    outboxScanner.scanOnce().catch(() => {});
  }, 5000);
});

export { app, server };
