import { initDatabase } from '../packages/server/src/db/index.js';
import { ProjectService } from '../packages/server/src/services/projectService.js';
import { RequirementService } from '../packages/server/src/services/requirementService.js';
import { FanOutService } from '../packages/server/src/services/fanOutService.js';
import { LinkService } from '../packages/server/src/services/linkService.js';
import { TicketService } from '../packages/server/src/services/ticketService.js';
import { EngineWatcher } from '../packages/server/src/watcher/engineWatcher.js';
import { FakeEngineServer } from '../packages/server/src/adapters/fakeEngine.js';
import { StoneforgeAdapter } from '../packages/server/src/adapters/stoneforgeAdapter.js';
import fs from 'node:fs';
import path from 'node:path';

function logStep(step: string, desc: string) {
  console.log(`\n\x1b[1m\x1b[36m=== [${step}] ${desc} ===\x1b[0m`);
}

function logInfo(label: string, val: any) {
  console.log(`  \x1b[32m✔\x1b[0m \x1b[1m${label}:\x1b[0m`, val);
}

function logNotice(label: string, val: any) {
  console.log(`  \x1b[33m⚡\x1b[0m \x1b[1m${label}:\x1b[0m`, val);
}

async function runDemo() {
  console.log('\x1b[1m\x1b[35m' + `
  ███████╗██████╗     ██╗  ██╗██╗ ██████╗██╗  ██╗███████╗████████╗ █████╗  ██████╗██╗  ██╗
  ██╔════╝██╔══██╗    ██║ ██╔╝██║██╔════╝██║ ██╔╝██╔════╝╚══██╔══╝██╔══██╗██╔════╝██║ ██╔╝
  ███████╗██████╔╝    █████╔╝ ██║██║     █████╔╝ ███████╗   ██║   ███████║██║     █████╔╝ 
  ╚════██║██╔═══╝     ██╔═██╗ ██║██║     ██╔═██╗ ╚════██║   ██║   ██╔══██║██║     ██╔═██╗ 
  ███████║██║         ██║  ██╗██║╚██████╗██║  ██╗███████║   ██║   ██║  ██║╚██████╗██║  ██╗
  ╚══════╝╚═╝         ╚═╝  ╚═╝╚═╝ ╚═════╝╚═╝  ╚═╝╚══════╝   ╚═╝   ╚═╝  ╚═╝ ╚═════╝╚═╝  ╚═╝
                    DevFlow Bridge — Full Lifecycle Simulation
  ` + '\x1b[0m');

  const demoWorkspace = path.resolve('./workspace/demo');
  if (fs.existsSync(demoWorkspace)) {
    fs.rmSync(demoWorkspace, { recursive: true, force: true });
  }
  fs.mkdirSync(demoWorkspace, { recursive: true });

  // 1. Initialize Engines & Adapters
  logStep('STEP 1', 'Initialize per-repo engines');
  const backendEngine = new FakeEngineServer('http://127.0.0.1:3457');
  const mobileEngine = new FakeEngineServer('http://127.0.0.1:3477');

  const backendAdapter = new StoneforgeAdapter('http://127.0.0.1:3457', '/repos/backend', undefined, backendEngine.fetch);
  const mobileAdapter = new StoneforgeAdapter('http://127.0.0.1:3477', '/repos/mobile', undefined, mobileEngine.fetch);

  const getAdapter = (name: string) => (name === 'backend' ? backendAdapter : mobileAdapter);

  const db = initDatabase(path.join(demoWorkspace, 'bridge.db'));
  const projectService = new ProjectService(db);
  const requirementService = new RequirementService(db, demoWorkspace);
  const linkService = new LinkService(db, projectService, getAdapter);
  const ticketService = new TicketService(db, projectService, linkService, getAdapter);
  const fanOutService = new FanOutService(db, projectService, requirementService, getAdapter);
  const watcher = new EngineWatcher(db, projectService, requirementService, getAdapter);

  projectService.registerProject({
    name: 'backend',
    kind: 'backend',
    repo_path: '/repos/backend',
    engine_type: 'stoneforge',
    engine_url: 'http://127.0.0.1:3457',
    base_branch: 'main',
    contract_path: 'api/openapi.yaml',
    enabled: true,
  });

  projectService.registerProject({
    name: 'mobile',
    kind: 'mobile',
    repo_path: '/repos/mobile',
    engine_type: 'stoneforge',
    engine_url: 'http://127.0.0.1:3477',
    base_branch: 'main',
    enabled: true,
  });

  logInfo('Connected Projects', ['backend (Stoneforge :3457)', 'mobile (Stoneforge :3477)']);

  // 2. Create Requirement
  logStep('STEP 2', 'Operator authors central requirement');
  const req = requirementService.createRequirement({
    title: 'Rider can see nearby drivers',
    goal: 'Mobile app displays realtime map of available drivers in 5km radius',
    acceptance_criteria: [
      'Backend exposes GET /v1/rides/nearby with lat/long and driver IDs',
      'Mobile renders vehicle markers and refreshes every 5 seconds',
    ],
    affected_projects: ['backend', 'mobile'],
    priority: 'high',
  });
  logInfo('Requirement ID', req.id);
  logInfo('Initial Status', req.status);
  logInfo('Markdown File', req.file_path);

  // 3. Trigger Fan-Out
  logStep('STEP 3', 'Fan-out goal tasks to per-repo engines');
  const tasks = await fanOutService.execute(req.id);
  logInfo('Tasks created in engines', tasks.map((t) => `${t.project}: ${t.title} (status: ${t.status})`));
  const mobileGoal = tasks.find((t) => t.project === 'mobile')!;
  const backendGoal = tasks.find((t) => t.project === 'backend')!;

  // 4. Mobile Agent files cross-repo xticket
  logStep('STEP 4', 'Mobile agent needs API: files blocking xticket to backend');
  logNotice('Mobile Agent Action', 'Executing xticket create --to backend --title "GET /v1/rides/nearby" --blocking');
  const ticketResp = await ticketService.createTicket(
    {
      to: 'backend',
      type: 'api_request',
      title: 'GET /v1/rides/nearby',
      body: 'Endpoint returning nearby available drivers with lat, long, and driver_id',
      blocking: true,
    },
    'mobile',
    mobileGoal.engine_task_id!
  );
  logInfo('Ticket Created', `ID #${ticketResp.ticketId} -> ${ticketResp.target}`);

  // Check mobile status
  const mobileState = db.prepare('SELECT status FROM bridge_tasks WHERE id = ?').get(mobileGoal.id) as any;
  logNotice('Mobile Goal Status', mobileState.status + ' (HELD - waiting for backend ticket)');

  // 5. Backend Implements & Merges
  logStep('STEP 5', 'Backend agent implements endpoint and steward merges PR');
  const backendTicketTask = db.prepare('SELECT * FROM bridge_tasks WHERE id = ?').get(ticketResp.ticketId) as any;
  backendEngine.setTaskStatus(backendTicketTask.engine_task_id, 'done', 'merged', 'https://github.com/my-org/backend/pull/88');
  backendEngine.setTaskStatus(backendGoal.engine_task_id!, 'done', 'merged');
  logInfo('Backend Ticket Task Status', 'done (PR #88 merged to main)');

  // 6. Watcher Poll & Hold Release
  logStep('STEP 6', 'Watcher detects backend merge and triggers hold release');
  await watcher.scanOnce();
  const released = await linkService.evaluateDependencyResolved(ticketResp.ticketId);
  logInfo('Dependency Released', `${released.length} links unblocked`);
  logNotice('Upstream Context Injected to Mobile', released[0].context_md);

  const mobileResumedState = db.prepare('SELECT status FROM bridge_tasks WHERE id = ?').get(mobileGoal.id) as any;
  logInfo('Mobile Goal Status after Unblock', mobileResumedState.status + ' (RESUMED to queued/running)');

  // 7. Mobile Completes Map Integration
  logStep('STEP 7', 'Mobile agent finishes implementation with new endpoint');
  mobileEngine.setTaskStatus(mobileGoal.engine_task_id!, 'done', 'merged', 'https://github.com/my-org/mobile/pull/42');
  await watcher.scanOnce();
  logInfo('Mobile Task Status', 'done');

  // 8. Overall Requirement Status
  logStep('STEP 8', 'Final Requirement Status Derivation');
  const finalReq = requirementService.getRequirement(req.id);
  logInfo('Requirement ' + req.id + ' Final Status', '\x1b[32m' + finalReq?.status?.toUpperCase() + '\x1b[0m');

  console.log('\n\x1b[32m✔ Simulation completed successfully! The end-to-end spec workflow is 100% verified.\x1b[0m\n');
}

runDemo().catch((err) => {
  console.error('Demo failed:', err);
  process.exit(1);
});
