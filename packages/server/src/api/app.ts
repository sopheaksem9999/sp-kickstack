import express, { Express, Request, Response, NextFunction } from 'express';
import fs from 'node:fs';
import crypto from 'node:crypto';
import { execFile } from 'node:child_process';
import helmet from 'helmet';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import { AppDatabase } from '../db/index.js';
import { WorkspaceService } from '../services/workspaceService.js';
import { ProjectService } from '../services/projectService.js';
import { RequirementService } from '../services/requirementService.js';
import { FanOutService } from '../services/fanOutService.js';
import { LinkService } from '../services/linkService.js';
import { TicketService } from '../services/ticketService.js';
import { SseBroadcaster } from '../sse/broadcaster.js';
import { Notifier } from '../notify/notifier.js';
import { SettingsService } from '../services/settingsService.js';
import { AssetService } from '../services/assetService.js';
import { SprintService } from '../services/sprintService.js';
import {
  CreateRequirementInputSchema,
  UpdateRequirementInputSchema,
  CreateTicketInputSchema,
  CreateWorkspaceInputSchema,
  UpdateWorkspaceInputSchema,
  UpdateRequirementProjectsInputSchema,
  UpdateRequirementMergePolicyInputSchema,
  CreateSharedAssetInputSchema,
  CreateSprintInputSchema,
  UpdateSprintInputSchema,
  AssignRequirementSprintInputSchema,
  ProjectSchema,
  RequirementStatusSchema,
  AiChatRequestSchema,
  CreateAiChatSessionInputSchema,
  UpdateAiChatSessionInputSchema,
  SendAiChatMessageInputSchema,
  IdeSettingsSchema,
  StartIdeInputSchema,
} from '@sp-kickstack/shared';
import { VcsSyncService } from '../services/vcsSyncService.js';
import { MetricsService } from '../services/metricsService.js';
import { AiDraftService } from '../services/aiDraftService.js';
import { AiChatService } from '../services/aiChatService.js';
import { IdeService } from '../services/ideService.js';
import { GitReviewService } from '../services/gitReviewService.js';
import { TerminalService } from '../services/terminalService.js';
import { requestGuard, resolveAllowedHosts, resolveWebOrigins } from './requestGuard.js';
import { TaskReactor } from '../services/taskReactor.js';
import { MergeGateService } from '../services/mergeGate.js';
import { DEDUPE_NOTE } from '../db/migrations.js';
import { QuestionService } from '../services/questionService.js';
import { ReviewService } from '../services/reviewService.js';
import { registerHumanLoopRoutes } from './humanLoopRoutes.js';
import { registerLocalEngineRoutes } from './localEngineRoutes.js';
import { BranchService } from '../services/branchService.js';
import { handOverManualTasks } from '../localEngine/handover.js';
import type { LocalEngineStatus } from '@sp-kickstack/shared';
import { NotificationService } from '../notify/notificationService.js';
import type { AdapterFactory } from '../services/fanOutService.js';
import { HttpError, badRequest } from '../lib/httpError.js';

export interface AppDependencies {
  db: AppDatabase;
  workspaceService: WorkspaceService;
  projectService: ProjectService;
  requirementService: RequirementService;
  sprintService?: SprintService;
  vcsSyncService?: VcsSyncService;
  metricsService?: MetricsService;
  settingsService?: SettingsService;
  aiDraftService?: AiDraftService;
  aiChatService?: AiChatService;
  ideService?: IdeService;
  terminalService?: TerminalService;
  fanOutService: FanOutService;
  linkService: LinkService;
  ticketService: TicketService;
  broadcaster: SseBroadcaster;
  notifier: Notifier;
  reactor?: TaskReactor;
  mergeGate?: MergeGateService;
  /** Engine adapters (needed by questions and reviews); routes that call engines answer 503 without it. */
  getAdapter?: AdapterFactory;
  questionService?: QuestionService;
  reviewService?: ReviewService;
  notificationService?: NotificationService;
  branchService?: BranchService;
  /** The in-server Local AI CLI engine (settings nudges it; Settings shows its status). */
  localEngine?: { status(): LocalEngineStatus; nudge(): void };
  /** DEMO_MODE=1: enables the simulated CLI runner, seeded logs and the demo "merge to main". */
  demoMode?: boolean;
  agentToken?: string;
  webhookSecret?: string;
  webOrigins?: string[];
  allowedHosts?: string[];
}

function safeEqual(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && crypto.timingSafeEqual(left, right);
}

export function createApp(deps: AppDependencies): Express {
  const app = express();

  const settingsService = deps.settingsService || new SettingsService(deps.db);
  const branchService = deps.branchService || new BranchService(deps.db, deps.projectService, settingsService);

  const ideService =
    deps.ideService ||
    new IdeService(settingsService, deps.projectService);

  const gitReviewService = new GitReviewService(deps.projectService);

  const terminalService =
    deps.terminalService ||
    new TerminalService(deps.projectService);

  const reactor =
    deps.reactor ||
    new TaskReactor(deps.db, deps.requirementService, deps.linkService, (evt) => deps.broadcaster.broadcast(evt));

  const mergeGate =
    deps.mergeGate || new MergeGateService(deps.db, deps.projectService, deps.requirementService, reactor, { settingsService });
  if (!deps.reactor) {
    // createApp built the reactor, so it also wires the auto-merge policy to it.
    reactor.setHooks({ onRequirementInReview: (id) => mergeGate.autoStart(id) });
  }

  const getAdapter: AdapterFactory =
    deps.getAdapter ??
    (() => {
      throw new HttpError(503, 'Engine adapters are not configured on this server');
    });
  const questionService =
    deps.questionService || new QuestionService(deps.db, deps.linkService, getAdapter, (evt) => deps.broadcaster.broadcast(evt));
  const reviewService =
    deps.reviewService ||
    new ReviewService(deps.db, deps.requirementService, deps.fanOutService, deps.ticketService, getAdapter, (evt) => deps.broadcaster.broadcast(evt));
  const notificationService = deps.notificationService || new NotificationService(deps.db, settingsService, deps.notifier);

  /** Start the merge gate in the background and answer 202 with the requirement (merge_state running). */
  const startMerge = (res: Response, id: string) => {
    const { done } = mergeGate.start(id, 'manual');
    done.catch(() => {});
    return res.status(202).json(deps.requirementService.getRequirement(id));
  };

  const vcsSyncService =
    deps.vcsSyncService ||
    new VcsSyncService(
      deps.db,
      deps.projectService,
      deps.requirementService,
      deps.linkService,
      deps.broadcaster,
      reactor
    );

  const metricsService =
    deps.metricsService ||
    new MetricsService(deps.db, deps.sprintService);

  const aiDraftService =
    deps.aiDraftService ||
    new AiDraftService(undefined, settingsService, deps.db);

  const aiChatService =
    deps.aiChatService ||
    new AiChatService(deps.db, deps.projectService, settingsService, deps.requirementService);

  const webOrigins = deps.webOrigins || resolveWebOrigins();
  const allowedHosts = deps.allowedHosts || resolveAllowedHosts();

  app.use(helmet({ contentSecurityPolicy: false }));
  app.use(requestGuard({ webOrigins, allowedHosts }));
  app.use(cors({ origin: webOrigins, credentials: true }));
  app.use(cookieParser());
  app.use(
    express.json({
      limit: '50mb',
      // Keep the exact bytes of webhook deliveries for signature verification.
      verify: (req, _res, buf) => {
        if (req.url?.startsWith('/api/webhooks/')) {
          (req as Request & { rawBody?: Buffer }).rawBody = Buffer.from(buf);
        }
      },
    })
  );
  app.use(express.urlencoded({ limit: '50mb', extended: true }));

  // Health
  app.get('/api/health', (_req, res) => {
    res.json({ ok: true, version: '0.2.0', demo_mode: Boolean(deps.demoMode) });
  });

  // Workspaces
  app.get('/api/workspaces', (_req, res) => {
    res.json(deps.workspaceService.listWorkspaces());
  });

  app.post('/api/workspaces', (req, res, next) => {
    try {
      const validated = CreateWorkspaceInputSchema.parse(req.body);
      const created = deps.workspaceService.createWorkspace(validated);
      res.status(201).json(created);
    } catch (err) {
      next(err);
    }
  });

  app.get('/api/workspaces/:id', (req, res) => {
    const ws = deps.workspaceService.getWorkspace(req.params.id);
    if (!ws) {
      return res.status(404).json({ error: 'Workspace not found' });
    }
    res.json(ws);
  });

  app.put('/api/workspaces/:id', (req, res, next) => {
    try {
      const validated = UpdateWorkspaceInputSchema.parse(req.body);
      const updated = deps.workspaceService.updateWorkspace(req.params.id, validated);
      res.json(updated);
    } catch (err) {
      next(err);
    }
  });

  app.delete('/api/workspaces/:id', (req, res, next) => {
    try {
      deps.workspaceService.deleteWorkspace(req.params.id);
      res.json({ ok: true });
    } catch (err) {
      next(err);
    }
  });

  // Projects
  app.get('/api/projects', (req, res) => {
    const ws = req.query.workspace as string | undefined;
    res.json(deps.projectService.listProjects(ws && ws !== 'all' ? ws : undefined));
  });

  app.get('/api/projects/:name', (req, res) => {
    const proj = deps.projectService.getProject(req.params.name);
    if (!proj) {
      return res.status(404).json({ error: 'Project not found' });
    }
    res.json(proj);
  });

  app.post('/api/projects', (req, res, next) => {
    try {
      const validated = ProjectSchema.parse(req.body);
      const proj = deps.projectService.registerProject(validated);
      res.status(201).json(proj);
    } catch (err) {
      next(err);
    }
  });

  app.put('/api/projects/:name', async (req, res, next) => {
    try {
      const before = deps.projectService.getProject(req.params.name);
      const updated = deps.projectService.updateProject(req.params.name, req.body);
      // Manual → Local AI CLI: tasks waiting on Manual (nobody works on them) start now.
      if (before?.engine_type === 'manual' && updated.engine_type === 'local') {
        const handedOver = await handOverManualTasks(deps.db, updated.name, {
          dispatchGoal: (id) => deps.fanOutService.dispatchGoal(id),
          dispatchTicket: (id) => deps.ticketService.dispatchTicket(id),
        });
        for (const taskId of handedOver) deps.broadcaster.broadcast({ type: 'task_updated', payload: { taskId } });
      }
      res.json(updated);
    } catch (err) {
      next(err);
    }
  });

  app.delete('/api/projects/:name', (req, res, next) => {
    try {
      deps.projectService.deleteProject(req.params.name);
      res.json({ ok: true });
    } catch (err) {
      next(err);
    }
  });

  app.post('/api/projects/:name/test', async (req, res, next) => {
    try {
      const proj = deps.projectService.getProject(req.params.name);
      if (!proj) {
        return res.status(404).json({ error: 'Project not found' });
      }
      res.json({ ok: true, status: proj.engine_status });
    } catch (err) {
      next(err);
    }
  });

  app.post('/api/projects/:name/open', async (req, res, next) => {
    try {
      const proj = deps.projectService.getProject(req.params.name);
      if (!proj) {
        return res.status(404).json({ error: 'Project not found' });
      }
      if (!fs.existsSync(proj.repo_path) || !fs.statSync(proj.repo_path).isDirectory()) {
        return res.status(400).json({ error: `Repository path is not a directory: ${proj.repo_path}` });
      }
      // argv only, never a shell; `open -R` reveals the folder instead of launching a bundle.
      const [cmd, args]: [string, string[]] =
        process.platform === 'darwin'
          ? ['open', ['-R', proj.repo_path]]
          : process.platform === 'win32'
          ? ['explorer', [proj.repo_path]]
          : ['xdg-open', [proj.repo_path]];
      execFile(cmd, args, () => {});
      res.json({ ok: true, path: proj.repo_path });
    } catch (err: any) {
      next(err);
    }
  });

  app.post('/api/projects/:name/open-ide', async (req, res, next) => {
    try {
      const { ideId } = req.body || {};
      const result = await ideService.openProjectInIde(req.params.name, ideId);
      res.json(result);
    } catch (err: any) {
      next(err);
    }
  });

  // Requirements
  app.get('/api/requirements', (req, res) => {
    const ws = req.query.workspace as string | undefined;
    const sessionId = req.query.session_id as string | undefined;
    res.json(deps.requirementService.listRequirements(ws && ws !== 'all' ? ws : undefined, sessionId));
  });

  app.post('/api/requirements', (req, res, next) => {
    try {
      const validated = CreateRequirementInputSchema.parse(req.body);
      const created = deps.requirementService.createRequirement(validated);
      deps.broadcaster.broadcast({ type: 'requirement_created', payload: created });
      res.status(201).json(created);
    } catch (err) {
      next(err);
    }
  });

  app.get('/api/requirements/:id', (req, res) => {
    const reqData = deps.requirementService.getRequirement(req.params.id);
    if (!reqData) {
      return res.status(404).json({ error: 'Requirement not found' });
    }
    res.json(reqData);
  });

  app.put('/api/requirements/:id', (req, res, next) => {
    try {
      const validated = UpdateRequirementInputSchema.parse(req.body);
      const updated = deps.requirementService.updateRequirement(req.params.id, validated);
      deps.broadcaster.broadcast({ type: 'requirement_updated', payload: updated });
      res.json(updated);
    } catch (err) {
      next(err);
    }
  });

  // CLI, model, effort, target branch and merge policy; editable after fan-out (the target branch excepted).
  app.put('/api/requirements/:id/run-settings', (req, res, next) => {
    try {
      const updated = deps.requirementService.updateRunSettings(req.params.id, req.body ?? {});
      deps.broadcaster.broadcast({ type: 'requirement_updated', payload: updated });
      res.json(updated);
    } catch (err) {
      next(err);
    }
  });

  // Target branch picker: branches of the chosen repositories (?projects=backend,frontend).
  app.get('/api/branches', (req, res, next) => {
    try {
      const raw = req.query.projects;
      if (typeof raw !== 'string' || !raw.trim()) throw badRequest('projects is required, e.g. ?projects=backend,frontend');
      res.json(branchService.listBranches(raw.split(',').map((p) => p.trim()).filter(Boolean)));
    } catch (err) {
      next(err);
    }
  });

  app.post('/api/requirements/:id/ready', async (req, res, next) => {
    try {
      const tasks = await deps.fanOutService.execute(req.params.id);
      deps.broadcaster.broadcast({ type: 'fanout_completed', payload: { reqId: req.params.id, tasks } });
      res.json({ ok: true, tasks });
    } catch (err) {
      next(err);
    }
  });

  const cancelRequirement = async (id: string) => {
    const result = await deps.fanOutService.cancel(id);
    deps.broadcaster.broadcast({ type: 'requirement_cancelled', payload: { id, ...result } });
    return result;
  };

  app.post('/api/requirements/:id/cancel', async (req, res, next) => {
    try {
      const result = await cancelRequirement(req.params.id);
      res.json({ ok: true, ...result });
    } catch (err) {
      next(err);
    }
  });

  app.put('/api/requirements/:id/status', async (req, res, next) => {
    try {
      const status = RequirementStatusSchema.parse(req.body.status);
      if (status === 'qa' && mergeGate.needsMerge(req.params.id)) {
        // Moving to QA is the merge trigger for branched work.
        return startMerge(res, req.params.id);
      }
      if (status === 'cancelled') {
        // Cancelling must also stop the engine agents, not just relabel the card.
        await cancelRequirement(req.params.id);
        return res.json(deps.requirementService.getRequirement(req.params.id));
      }
      const updated = deps.requirementService.updateRequirementStatus(req.params.id, status);
      if (!updated) return res.status(404).json({ error: 'Requirement not found' });
      deps.broadcaster.broadcast({ type: 'requirement_status_changed', payload: { id: req.params.id, status } });
      res.json(updated);
    } catch (err) {
      next(err);
    }
  });

  app.post('/api/requirements/:id/merge-to-qa', (req, res, next) => {
    try {
      startMerge(res, req.params.id);
    } catch (err) {
      next(err);
    }
  });

  app.post('/api/requirements/:id/merge-to-main', (req, res, next) => {
    try {
      // Outside demo mode the bridge performs no git operation: the operator confirms
      // that the reviewed work was merged, and the response says so.
      const result = deps.demoMode
        ? deps.requirementService.mergeRequirementToMain(req.params.id)
        : deps.requirementService.confirmMerged(req.params.id);
      deps.broadcaster.broadcast({
        type: deps.demoMode ? 'merge_ready' : 'merge_confirmed',
        payload: { id: req.params.id, ...result },
      });
      res.json(result);
    } catch (err) {
      next(err);
    }
  });

  app.get('/api/requirements/:id/graph', (req, res) => {
    const tasks = deps.db
      .prepare("SELECT * FROM bridge_tasks WHERE req_id = ? AND role <> 'question' AND (last_error IS NULL OR last_error <> ?)")
      .all(req.params.id, DEDUPE_NOTE);
    const links = deps.db
      .prepare(`
        SELECT l.* FROM links l
        JOIN bridge_tasks t ON l.task_id = t.id
        JOIN bridge_tasks d ON l.depends_on_id = d.id
        WHERE t.req_id = ? AND d.role <> 'question'
      `)
      .all(req.params.id);
    res.json({ tasks, links });
  });

  app.put('/api/requirements/:id/projects', (req, res, next) => {
    try {
      const validated = UpdateRequirementProjectsInputSchema.parse(req.body);
      const updated = deps.requirementService.updateRequirementProjects(req.params.id, validated.affected_projects);
      if (!updated) return res.status(404).json({ error: 'Requirement not found' });
      deps.broadcaster.broadcast({ type: 'requirement_created', payload: updated });
      res.json(updated);
    } catch (err) {
      next(err);
    }
  });

  app.put('/api/requirements/:id/merge-policy', (req, res, next) => {
    try {
      const validated = UpdateRequirementMergePolicyInputSchema.parse(req.body);
      const updated = deps.requirementService.updateRequirementMergePolicy(req.params.id, validated.merge_policy || null);
      if (!updated) return res.status(404).json({ error: 'Requirement not found' });
      deps.broadcaster.broadcast({ type: 'requirement_created', payload: updated });
      res.json(updated);
    } catch (err) {
      next(err);
    }
  });

  app.put('/api/requirements/:id/sprint', (req, res, next) => {
    try {
      const validated = AssignRequirementSprintInputSchema.parse(req.body);
      const updated = deps.requirementService.updateRequirementSprint(req.params.id, validated.sprint_id ?? null);
      if (!updated) return res.status(404).json({ error: 'Requirement not found' });
      deps.broadcaster.broadcast({ type: 'requirement_created', payload: updated });
      res.json(updated);
    } catch (err) {
      next(err);
    }
  });

  // Sprints (Scrum Management)
  const sprintService = deps.sprintService || new SprintService(deps.db);

  app.get('/api/sprints', (req, res) => {
    const ws = req.query.workspace as string | undefined;
    res.json(sprintService.listSprints(ws && ws !== 'all' ? ws : undefined));
  });

  app.post('/api/sprints', (req, res, next) => {
    try {
      const validated = CreateSprintInputSchema.parse(req.body);
      const created = sprintService.createSprint(validated);
      deps.broadcaster.broadcast({ type: 'sprint_created', payload: created });
      res.status(201).json(created);
    } catch (err) {
      next(err);
    }
  });

  app.get('/api/sprints/:id', (req, res) => {
    const sprint = sprintService.getSprint(req.params.id);
    if (!sprint) return res.status(404).json({ error: 'Sprint not found' });
    res.json(sprint);
  });

  app.put('/api/sprints/:id', (req, res, next) => {
    try {
      const validated = UpdateSprintInputSchema.parse(req.body);
      const updated = sprintService.updateSprint(req.params.id, validated);
      deps.broadcaster.broadcast({ type: 'sprint_updated', payload: updated });
      res.json(updated);
    } catch (err) {
      next(err);
    }
  });

  app.post('/api/sprints/:id/start', (req, res, next) => {
    try {
      const started = sprintService.startSprint(req.params.id);
      deps.broadcaster.broadcast({ type: 'sprint_started', payload: started });
      res.json(started);
    } catch (err) {
      next(err);
    }
  });

  app.post('/api/sprints/:id/complete', (req, res, next) => {
    try {
      const result = sprintService.completeSprint(req.params.id);
      deps.broadcaster.broadcast({ type: 'sprint_completed', payload: result });
      res.json(result);
    } catch (err) {
      next(err);
    }
  });

  // Attachments & Shared Assets Hub
  const assetService = new AssetService(deps.db);

  app.get('/api/assets', (req, res) => {
    const ws = req.query.workspace as string | undefined;
    res.json(assetService.getAssets(ws && ws !== 'all' ? ws : undefined));
  });

  app.post('/api/assets/shared', (req, res, next) => {
    try {
      const validated = CreateSharedAssetInputSchema.parse(req.body);
      const created = assetService.createSharedAsset(validated);
      res.status(201).json(created);
    } catch (err) {
      next(err);
    }
  });

  app.delete('/api/assets/shared/:id', (req, res) => {
    const result = assetService.deleteSharedAsset(req.params.id);
    res.json(result);
  });

  // Settings & Branch Merge Rules
  app.get('/api/settings', (_req, res) => {
    res.json({
      branch_merge: settingsService.getBranchMergeSettings(),
      ai_cli: settingsService.getAiCliSettings(),
    });
  });

  app.put('/api/settings/branch-merge', (req, res, next) => {
    try {
      const updated = settingsService.updateBranchMergeSettings(req.body);
      deps.broadcaster.broadcast({ type: 'settings_updated', payload: { branch_merge: updated } });
      res.json(updated);
    } catch (err) {
      next(err);
    }
  });

  app.put('/api/settings/ai-cli', (req, res, next) => {
    try {
      const updated = settingsService.updateAiCliSettings(req.body);
      deps.broadcaster.broadcast({ type: 'settings_updated', payload: { ai_cli: updated } });
      res.json(updated);
    } catch (err) {
      next(err);
    }
  });

  // Tasks. Filters (all optional, combinable): req, project, status, workspace (the requirement's
  // workspace) and role (comma separated). Each row carries its requirement's title, priority and status.
  app.get('/api/tasks', (req, res) => {
    // A filter given twice (?workspace=a&workspace=b) or as ?workspace[]=a / ?workspace[x]=a arrives as an array
    // or an object. Ignoring it would answer with the unfiltered list, so refuse it instead.
    const filterNames = ['req', 'project', 'status', 'workspace', 'role'] as const;
    if (filterNames.some((name) => req.query[name] !== undefined && typeof req.query[name] !== 'string')) {
      return res.status(400).json({ error: 'Each filter takes one value, e.g. ?workspace=default' });
    }
    const one = (value: unknown) => (typeof value === 'string' && value !== '' ? value : undefined);
    const reqId = one(req.query.req);
    const project = one(req.query.project);
    const status = one(req.query.status);
    const workspace = one(req.query.workspace);
    const roles = (one(req.query.role) ?? '').split(',').map((r) => r.trim()).filter(Boolean);

    let query = `
      SELECT t.*, r.title AS req_title, r.priority AS req_priority, r.status AS req_status
      FROM bridge_tasks t
      LEFT JOIN requirements r ON r.id = t.req_id
      WHERE 1=1`;
    const params: string[] = [];
    if (reqId) {
      query += ' AND t.req_id = ?';
      params.push(reqId);
    }
    if (project) {
      query += ' AND t.project = ?';
      params.push(project);
    }
    if (status) {
      query += ' AND t.status = ?';
      params.push(status);
    }
    if (workspace) {
      query += ' AND r.workspace_id = ?';
      params.push(workspace);
    }
    if (roles.length > 0) {
      query += ` AND t.role IN (${roles.map(() => '?').join(', ')})`;
      params.push(...roles);
    }
    query += ' ORDER BY t.id ASC';
    res.json(deps.db.prepare(query).all(...params));
  });

  app.post('/api/tasks/:id/mark-done', async (req, res, next) => {
    try {
      const taskId = Number(req.params.id);
      const task = deps.db.prepare('SELECT * FROM bridge_tasks WHERE id = ?').get(taskId) as any;
      if (!task) return res.status(404).json({ error: 'Task not found' });
      if (task.role === 'question') {
        return res.status(409).json({ error: `Task #${taskId} is a question for a person; answer it with POST /api/questions/${taskId}/answer` });
      }
      if (task.status === 'done') return res.json({ ok: true, releasedLinks: [] });

      const now = new Date().toISOString();
      const updated = deps.db
        .prepare('UPDATE bridge_tasks SET status = ?, updated_at = ? WHERE id = ? AND status = ?')
        .run('done', now, taskId, task.status);
      if (updated.changes !== 1) {
        return res.status(409).json({ error: 'Task changed while marking it done; refresh and retry' });
      }

      // Releases dependents and re-derives the requirement status (same path as the watcher)
      const { releasedLinks } = await reactor.onTaskStatusChanged(task, task.status, 'done', 'manual');

      res.json({ ok: true, releasedLinks });
    } catch (err) {
      next(err);
    }
  });

  // Retry a stopped goal/ticket on its existing branch (old engine task cancelled).
  app.post('/api/tasks/:id/retry', async (req, res, next) => {
    try {
      const taskId = Number(req.params.id);
      const task = deps.db.prepare('SELECT role FROM bridge_tasks WHERE id = ?').get(taskId) as { role: string } | undefined;
      if (!task) return res.status(404).json({ error: 'Task not found' });
      const retried =
        task.role === 'goal'
          ? await deps.fanOutService.retryGoal(taskId, req.body ?? {})
          : task.role === 'ticket'
          ? await deps.ticketService.retryTicket(taskId, req.body ?? {})
          : null;
      if (!retried) return res.status(409).json({ error: `A ${task.role} task cannot be retried` });
      deps.broadcaster.broadcast({ type: 'task_retried', payload: { taskId, status: retried.status } });
      res.json(retried);
    } catch (err) {
      next(err);
    }
  });

  // Task Live Execution Logs
  app.get('/api/tasks/:id/logs', (req, res) => {
    const taskId = Number(req.params.id);
    const task = deps.db.prepare('SELECT * FROM bridge_tasks WHERE id = ?').get(taskId) as any;
    if (!task) return res.status(404).json({ error: 'Task not found' });

    let logs = deps.db
      .prepare('SELECT * FROM task_logs WHERE task_id = ? ORDER BY id ASC')
      .all(taskId) as any[];

    // Illustrative log lines are a demo feature; never invent history in normal mode.
    if (logs.length === 0 && deps.demoMode) {
      const now = new Date().toISOString();
      const project = deps.projectService.getProject(task.project);
      const engineType = project?.engine_type || 'local-ai-cli';
      const baseBranch = project?.base_branch || 'develop';

      const initialEntries = [
        {
          stream: 'system',
          message: `[DevFlow Bridge] Task #${task.id} initialized for project "${task.project}".`,
          created_at: task.created_at || now,
        },
        {
          stream: 'system',
          message: `[Engine] Target engine: ${engineType} | Branch: ${baseBranch} | Role: ${task.role}.`,
          created_at: task.created_at || now,
        },
        {
          stream: 'stdout',
          message: `[Autonomy] Strategy A protocol active (Autonomous Headless - Zero Human Prompt Halts).`,
          created_at: task.created_at || now,
        },
        {
          stream: 'stdout',
          message: `[Task Spec] "${task.title}"`,
          created_at: task.created_at || now,
        },
        {
          stream: task.status === 'in_progress' ? 'stdout' : task.status === 'done' ? 'stdout' : 'system',
          message: `[Status] Current state: ${task.status.toUpperCase()}${task.pr_url ? ` | PR: ${task.pr_url}` : ''}`,
          created_at: task.updated_at || now,
        },
      ];

      for (const entry of initialEntries) {
        deps.db
          .prepare('INSERT INTO task_logs (task_id, stream, message, created_at) VALUES (?, ?, ?, ?)')
          .run(taskId, entry.stream, entry.message, entry.created_at);
      }

      logs = deps.db
        .prepare('SELECT * FROM task_logs WHERE task_id = ? ORDER BY id ASC')
        .all(taskId) as any[];
    }

    const events = deps.db
      .prepare('SELECT * FROM events WHERE task_id = ? ORDER BY id ASC')
      .all(taskId) as any[];

    res.json({ task, logs, events });
  });

  app.post('/api/tasks/:id/run-cli', async (req, res, next) => {
    try {
      if (!deps.demoMode) {
        return res
          .status(501)
          .json({ error: 'The CLI runner is a simulation; start the server with DEMO_MODE=1 to use it' });
      }

      const taskId = Number(req.params.id);
      const task = deps.db.prepare('SELECT * FROM bridge_tasks WHERE id = ?').get(taskId) as any;
      if (!task) return res.status(404).json({ error: 'Task not found' });

      const now = new Date().toISOString();
      const project = deps.projectService.getProject(task.project);
      const repoPath = project?.repo_path || `/workspace/${task.project}`;

      // Update to in_progress
      deps.db.prepare('UPDATE bridge_tasks SET status = ?, updated_at = ? WHERE id = ?').run('running', now, taskId);
      deps.broadcaster.broadcast({
        type: 'task_status_changed',
        payload: { taskId, status: 'running' },
      });

      const appendLog = (stream: 'stdout' | 'stderr' | 'system', msg: string) => {
        const time = new Date().toISOString();
        deps.db.prepare('INSERT INTO task_logs (task_id, stream, message, created_at) VALUES (?, ?, ?, ?)').run(taskId, stream, msg, time);
        deps.broadcaster.broadcast({
          type: 'task_log',
          payload: { taskId, stream, message: msg, timestamp: time },
        });
      };

      appendLog('system', `[CLI Runner] Executing autonomous task in ${repoPath}...`);
      appendLog('stdout', `$ git checkout develop && git pull origin develop`);
      appendLog('stdout', `$ ${project?.engine_type === 'stoneforge' ? 'stoneforge task execute' : 'claude --session-id req-' + task.req_id} "${task.title}"`);
      appendLog('stdout', `[AI CLI] Analyzing repository AST and generating requirement implementation...`);
      appendLog('stdout', `[AI CLI] Tests verified: 100% pass on develop branch.`);
      appendLog('system', `[VCS] Pushing feature branch and opening pull request to develop.`);

      const prUrl = `https://github.com/my-org/${task.project}/pull/${Math.floor(Math.random() * 80 + 20)}`;
      deps.db
        .prepare('UPDATE bridge_tasks SET status = ?, pr_url = ?, updated_at = ? WHERE id = ?')
        .run('in_review', prUrl, new Date().toISOString(), taskId);

      appendLog('stdout', `[PR Ready] Pull request opened: ${prUrl}`);
      appendLog('system', `[Done] Task transitioned to IN_REVIEW.`);

      deps.broadcaster.broadcast({
        type: 'task_status_changed',
        payload: { taskId, status: 'in_review', pr_url: prUrl },
      });

      const updatedTask = deps.db.prepare('SELECT * FROM bridge_tasks WHERE id = ?').get(taskId) as any;
      res.json({ ok: true, task: updatedTask });
    } catch (err) {
      next(err);
    }
  });

  // Links
  app.post('/api/links/:id/release', async (req, res, next) => {
    try {
      const linkId = Number(req.params.id);
      const link = deps.linkService.getLink(linkId);
      if (!link) return res.status(404).json({ error: 'Link not found' });

      const released = await deps.linkService.forceRelease(linkId);
      deps.broadcaster.broadcast({ type: 'link_released', payload: { linkId, released } });
      res.json({ ok: true, released });
    } catch (err) {
      next(err);
    }
  });

  app.post('/api/links/:id/cancel', async (req, res, next) => {
    try {
      const linkId = Number(req.params.id);
      if (!deps.linkService.getLink(linkId)) return res.status(404).json({ error: 'Link not found' });
      // The source resumes if this was the last thing it waited on.
      const released = await deps.linkService.cancelLink(linkId);
      deps.broadcaster.broadcast({ type: 'link_cancelled', payload: { linkId, released } });
      res.json({ ok: true, released });
    } catch (err) {
      next(err);
    }
  });

  // Tickets
  const handleCreateTicket = async (req: Request, res: Response, next: NextFunction) => {
    try {
      const validated = CreateTicketInputSchema.parse(req.body);
      const sourceProject = (req.body.project as string) || 'manual';
      const sourceTaskId = req.body.engineTaskId as string | undefined;

      const resp = await deps.ticketService.createTicket(validated, sourceProject, sourceTaskId);
      deps.broadcaster.broadcast({ type: 'ticket_created', payload: resp });
      res.status(201).json(resp);
    } catch (err) {
      // TicketService errors carry their HTTP status (400 invalid, 429 limits, 502 engine).
      next(err);
    }
  };

  const requireAgentToken = (req: Request, res: Response, next: NextFunction) => {
    if (!deps.agentToken) return next();
    if (safeEqual(req.headers.authorization || '', `Bearer ${deps.agentToken}`)) return next();
    return res.status(401).json({ error: 'Invalid or missing agent token' });
  };

  app.post('/api/tickets', requireAgentToken, handleCreateTicket);
  app.post('/api/agent/tickets', requireAgentToken, handleCreateTicket);
  registerHumanLoopRoutes(app, { questionService, reviewService, requirementService: deps.requirementService, settingsService, notificationService, broadcaster: deps.broadcaster, requireAgentToken });
  registerLocalEngineRoutes(app, { settingsService, broadcaster: deps.broadcaster, localEngine: deps.localEngine });

  // VCS Webhooks Sync
  const hasValidGitHubSignature = (req: Request): boolean => {
    if (!deps.webhookSecret) return true;
    const signature = req.headers['x-hub-signature-256'];
    const raw = (req as Request & { rawBody?: Buffer }).rawBody;
    if (typeof signature !== 'string' || !raw) return false;
    const expected = 'sha256=' + crypto.createHmac('sha256', deps.webhookSecret).update(raw).digest('hex');
    return safeEqual(signature, expected);
  };

  app.post('/api/webhooks/github', async (req, res, next) => {
    try {
      // GitHub delivers JSON; refusing form bodies stops <form>-based cross-site posts.
      if (!req.is('application/json')) {
        return res.status(415).json({ error: 'Webhook payload must be application/json' });
      }
      if (!hasValidGitHubSignature(req)) {
        return res.status(401).json({ error: 'Invalid webhook signature' });
      }
      const event = (req.headers['x-github-event'] as string) || req.body?.event || 'pull_request';
      const result = await vcsSyncService.handleGitHubWebhook(event, req.body);
      res.status(200).json(result);
    } catch (err) {
      next(err);
    }
  });

  // Sprint Metrics & Burndown
  app.get('/api/sprints/:id/burndown', (req, res) => {
    const data = metricsService.getSprintBurndown(req.params.id);
    if (!data) {
      return res.status(404).json({ error: 'Sprint not found' });
    }
    res.json(data);
  });

  // Telemetry & Latency
  app.get('/api/telemetry', (req, res) => {
    const data = metricsService.getTelemetry(req.query.workspace as string | undefined);
    res.json(data);
  });

  // AI Requirement Drafting & Assistant Integration
  app.get('/api/ai/providers', async (req, res, next) => {
    try {
      res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
      res.setHeader('Pragma', 'no-cache');
      res.setHeader('Expires', '0');
      if (req.query.refresh === 'true') {
        aiDraftService.invalidateAgyUsageCache();
      }
      const providers = await aiDraftService.getProviders();
      res.json(providers);
    } catch (err) {
      next(err);
    }
  });

  app.post('/api/ai/draft-requirement', async (req, res, next) => {
    try {
      const { prompt, provider, model, workspace_id } = req.body;
      if (!prompt || typeof prompt !== 'string') {
        return res.status(400).json({ error: 'prompt is required and must be a string' });
      }

      const knownProjects = deps.projectService
        .listProjects(workspace_id)
        .map((p) => p.name);

      const drafted = await aiDraftService.draftRequirement(prompt, {
        provider,
        model,
        knownProjects: knownProjects.length > 0 ? knownProjects : ['backend', 'frontend', 'mobile'],
      });

      res.json(drafted);
    } catch (err) {
      next(err);
    }
  });

  app.post('/api/ai/chat', async (req, res, next) => {
    try {
      const parsed = AiChatRequestSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ error: parsed.error.issues[0]?.message || 'Invalid chat request' });
      }

      const response = await aiChatService.chat(parsed.data);
      res.json(response);
    } catch (err) {
      next(err);
    }
  });

  // AI Multi-Chat Session Management (Persistent Local Context)
  app.get('/api/ai/chat/sessions', (req, res) => {
    const workspaceId = req.query.workspace_id as string | undefined;
    const sessions = aiChatService.listSessions(workspaceId);
    res.json(sessions);
  });

  app.post('/api/ai/chat/sessions', (req, res, next) => {
    try {
      const validated = CreateAiChatSessionInputSchema.parse(req.body);
      const session = aiChatService.createSession(validated);
      res.status(201).json(session);
    } catch (err) {
      next(err);
    }
  });

  app.get('/api/ai/chat/sessions/:id', (req, res) => {
    const session = aiChatService.getSession(req.params.id);
    if (!session) {
      return res.status(404).json({ error: 'Chat session not found' });
    }
    res.json(session);
  });

  app.patch('/api/ai/chat/sessions/:id', (req, res, next) => {
    try {
      const validated = UpdateAiChatSessionInputSchema.parse(req.body);
      const updated = aiChatService.updateSession(req.params.id, validated);
      if (!updated) {
        return res.status(404).json({ error: 'Chat session not found' });
      }
      res.json(updated);
    } catch (err) {
      next(err);
    }
  });

  app.delete('/api/ai/chat/sessions/:id', (req, res) => {
    const ok = aiChatService.deleteSession(req.params.id);
    res.json({ ok });
  });

  app.post('/api/ai/chat/sessions/:id/messages', async (req, res, next) => {
    try {
      const validated = SendAiChatMessageInputSchema.parse(req.body);
      const result = await aiChatService.sendSessionMessage(req.params.id, validated);
      res.json(result);
    } catch (err: any) {
      if (err.message?.includes('not found')) {
        return res.status(404).json({ error: err.message });
      }
      next(err);
    }
  });

  app.post('/api/ai/chat/sessions/:id/create-requirement', async (req, res, next) => {
    try {
      const extraInstructions = typeof req.body?.instructions === 'string' ? req.body.instructions : undefined;
      const result = await aiChatService.createRequirementFromSession(req.params.id, extraInstructions);
      res.json(result);
    } catch (err: any) {
      if (err.message?.includes('not found')) {
        return res.status(404).json({ error: err.message });
      }
      next(err);
    }
  });

  // Notifications & Events
  app.get('/api/notifications', (_req, res) => {
    const events = deps.db
      .prepare('SELECT * FROM events ORDER BY id DESC LIMIT 50')
      .all()
      .map((row: any) => ({
        ...row,
        payload: JSON.parse(row.payload || '{}'),
        read: Boolean(row.read),
      }));
    res.json(events);
  });

  app.post('/api/notifications/read', (_req, res) => {
    deps.db.prepare('UPDATE events SET read = 1').run();
    res.json({ ok: true });
  });

  // SSE Realtime Stream
  app.get('/api/events', (req, res) => {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders();

    deps.broadcaster.addClient(res);

    // Initial heartbeat
    res.write('data: {"type":"connected"}\n\n');
  });

  // Embedded IDE (code-server / openvscode-server)
  app.get('/api/ide/status', async (_req, res, next) => {
    try {
      const status = await ideService.getStatus();
      res.json(status);
    } catch (err) {
      next(err);
    }
  });

  app.get('/api/ide/detected', (_req, res, next) => {
    try {
      const detected = ideService.detectInstalledIdes();
      res.json(detected);
    } catch (err) {
      next(err);
    }
  });

  app.get('/api/ide/settings', (_req, res) => {
    res.json(ideService.getSettings());
  });

  app.put('/api/ide/settings', (req, res, next) => {
    try {
      const parsed = IdeSettingsSchema.partial().parse(req.body);
      const updated = ideService.updateSettings(parsed);
      res.json(updated);
    } catch (err) {
      next(err);
    }
  });

  app.post('/api/ide/start', async (req, res, next) => {
    try {
      const validated = StartIdeInputSchema.parse(req.body);
      const status = await ideService.startServer({
        projectName: validated.project_name,
        folderPath: validated.folder_path,
        port: validated.port,
      });
      res.json(status);
    } catch (err) {
      next(err);
    }
  });

  app.post('/api/ide/stop', async (_req, res, next) => {
    try {
      const status = await ideService.stopServer();
      res.json(status);
    } catch (err) {
      next(err);
    }
  });

  app.get('/api/ide/projects/:name/url', (req, res, next) => {
    try {
      const project = deps.projectService.getProject(req.params.name);
      if (!project) return res.status(404).json({ error: 'Project not found' });
      const url = ideService.getUrlForFolder(project.repo_path);
      res.json({ project: project.name, repo_path: project.repo_path, url });
    } catch (err) {
      next(err);
    }
  });

  // Native In-App Git Review & Code Diff Endpoints
  app.get('/api/projects/:name/git-review/summary', (req, res, next) => {
    try {
      const target = (req.query.target as string) || 'HEAD';
      const summary = gitReviewService.getReviewSummary(req.params.name, target);
      res.json(summary);
    } catch (err) {
      next(err);
    }
  });

  app.get('/api/projects/:name/git-review/diff', (req, res, next) => {
    try {
      const file = req.query.file as string;
      if (!file) return res.status(400).json({ error: 'file query param is required' });
      const target = (req.query.target as string) || 'HEAD';
      const diff = gitReviewService.getFileDiff(req.params.name, file, target);
      res.json(diff);
    } catch (err) {
      next(err);
    }
  });

  app.get('/api/projects/:name/git-review/tree', (req, res, next) => {
    try {
      const tree = gitReviewService.getFileTree(req.params.name);
      res.json(tree);
    } catch (err) {
      next(err);
    }
  });

  app.get('/api/projects/:name/git-review/file', (req, res, next) => {
    try {
      const filePath = req.query.path as string;
      if (!filePath) return res.status(400).json({ error: 'path query param is required' });
      const fileData = gitReviewService.getFileContent(req.params.name, filePath);
      res.json(fileData);
    } catch (err) {
      next(err);
    }
  });

  // Project Persistent Terminal Endpoints
  app.get('/api/projects/:name/terminal', (req, res, next) => {
    try {
      const status = terminalService.getSession(req.params.name);
      res.json(status);
    } catch (err) {
      next(err);
    }
  });

  app.post('/api/projects/:name/terminal/input', (req, res, next) => {
    try {
      const input = typeof req.body?.input === 'string' ? req.body.input : '';
      const status = terminalService.sendInput(req.params.name, input);
      res.json(status);
    } catch (err) {
      next(err);
    }
  });

  app.post('/api/projects/:name/terminal/interrupt', (req, res, next) => {
    try {
      const ok = terminalService.interrupt(req.params.name);
      res.json({ ok });
    } catch (err) {
      next(err);
    }
  });

  app.post('/api/projects/:name/terminal/restart', (req, res, next) => {
    try {
      const status = terminalService.restart(req.params.name);
      res.json(status);
    } catch (err) {
      next(err);
    }
  });

  app.post('/api/projects/:name/terminal/clear', (req, res, next) => {
    try {
      const ok = terminalService.clear(req.params.name);
      res.json({ ok });
    } catch (err) {
      next(err);
    }
  });

  app.get('/api/projects/:name/terminal/stream', (req, res) => {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders?.();

    const current = terminalService.getSession(req.params.name);
    res.write(`data: ${JSON.stringify({ type: 'init', session: current })}\n\n`);

    const unsubscribe = terminalService.subscribe(req.params.name, (chunk) => {
      res.write(`data: ${JSON.stringify({ type: 'chunk', chunk })}\n\n`);
    });

    req.on('close', () => {
      unsubscribe();
    });
  });

  app.get('/api/terminals/active', (_req, res) => {
    res.json(terminalService.getActiveProjects());
  });

  // Error handling middleware
  app.use((err: any, _req: Request, res: Response, _next: NextFunction) => {
    let status = err.status || 500;
    let message = err.message || 'Internal Server Error';

    if (err.issues && Array.isArray(err.issues)) {
      status = 400;
      message = err.issues
        .map((issue: any) => `${issue.path.join('.') || 'field'}: ${issue.message}`)
        .join('; ');
    }

    res.status(status).json({
      error: message,
    });
  });

  return app;
}
