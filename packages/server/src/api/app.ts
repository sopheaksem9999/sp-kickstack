import express, { Express, Request, Response, NextFunction } from 'express';
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
import {
  CreateRequirementInputSchema,
  CreateTicketInputSchema,
  CreateWorkspaceInputSchema,
  UpdateWorkspaceInputSchema,
  ProjectSchema,
} from '@sp-kickstack/shared';

export interface AppDependencies {
  db: AppDatabase;
  workspaceService: WorkspaceService;
  projectService: ProjectService;
  requirementService: RequirementService;
  fanOutService: FanOutService;
  linkService: LinkService;
  ticketService: TicketService;
  broadcaster: SseBroadcaster;
  notifier: Notifier;
  agentToken?: string;
}

export function createApp(deps: AppDependencies): Express {
  const app = express();

  app.use(helmet({ contentSecurityPolicy: false }));
  app.use(cors({ origin: true, credentials: true }));
  app.use(cookieParser());
  app.use(express.json());

  // Health
  app.get('/api/health', (_req, res) => {
    res.json({ ok: true, version: '0.2.0' });
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

  app.post('/api/projects', (req, res, next) => {
    try {
      const validated = ProjectSchema.parse(req.body);
      const proj = deps.projectService.registerProject(validated);
      res.status(201).json(proj);
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

  // Requirements
  app.get('/api/requirements', (req, res) => {
    const ws = req.query.workspace as string | undefined;
    res.json(deps.requirementService.listRequirements(ws && ws !== 'all' ? ws : undefined));
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

  app.post('/api/requirements/:id/ready', async (req, res, next) => {
    try {
      const tasks = await deps.fanOutService.execute(req.params.id);
      deps.broadcaster.broadcast({ type: 'fanout_completed', payload: { reqId: req.params.id, tasks } });
      res.json({ ok: true, tasks });
    } catch (err) {
      next(err);
    }
  });

  app.post('/api/requirements/:id/cancel', (req, res) => {
    deps.requirementService.updateStatus(req.params.id, 'cancelled');
    deps.broadcaster.broadcast({ type: 'requirement_cancelled', payload: { id: req.params.id } });
    res.json({ ok: true });
  });

  app.get('/api/requirements/:id/graph', (req, res) => {
    const tasks = deps.db
      .prepare('SELECT * FROM bridge_tasks WHERE req_id = ?')
      .all(req.params.id);
    const links = deps.db
      .prepare(`
        SELECT l.* FROM links l
        JOIN bridge_tasks t ON l.task_id = t.id
        WHERE t.req_id = ?
      `)
      .all(req.params.id);
    res.json({ tasks, links });
  });

  // Tasks
  app.get('/api/tasks', (req, res) => {
    const { req: reqId, project } = req.query;
    let query = 'SELECT * FROM bridge_tasks WHERE 1=1';
    const params: any[] = [];
    if (reqId) {
      query += ' AND req_id = ?';
      params.push(reqId);
    }
    if (project) {
      query += ' AND project = ?';
      params.push(project);
    }
    query += ' ORDER BY id ASC';
    const tasks = deps.db.prepare(query).all(...params);
    res.json(tasks);
  });

  app.post('/api/tasks/:id/mark-done', async (req, res, next) => {
    try {
      const taskId = Number(req.params.id);
      const now = new Date().toISOString();
      deps.db.prepare('UPDATE bridge_tasks SET status = "done", updated_at = ? WHERE id = ?').run(now, taskId);

      // Release any dependent links
      const releasedLinks = await deps.linkService.evaluateDependencyResolved(taskId);

      // Recalculate requirement status
      const task = deps.db.prepare('SELECT req_id FROM bridge_tasks WHERE id = ?').get(taskId) as any;
      if (task) {
        deps.requirementService.recalculateDerivedStatus(task.req_id);
      }

      deps.broadcaster.broadcast({
        type: 'task_done',
        payload: { taskId, releasedLinks },
      });

      res.json({ ok: true, releasedLinks });
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

      const released = await deps.linkService.evaluateDependencyResolved(link.depends_on_id);
      deps.broadcaster.broadcast({ type: 'link_released', payload: { linkId, released } });
      res.json({ ok: true, released });
    } catch (err) {
      next(err);
    }
  });

  app.post('/api/links/:id/cancel', (req, res) => {
    const linkId = Number(req.params.id);
    deps.db.prepare('UPDATE links SET state = "cancelled" WHERE id = ?').run(linkId);
    deps.broadcaster.broadcast({ type: 'link_cancelled', payload: { linkId } });
    res.json({ ok: true });
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
    } catch (err: any) {
      if (err.message.includes('not registered') || err.message.includes('exceeds')) {
        return res.status(400).json({ error: err.message });
      }
      if (err.message.includes('limit')) {
        return res.status(429).json({ error: err.message });
      }
      next(err);
    }
  };

  app.post('/api/tickets', handleCreateTicket);
  app.post('/api/agent/tickets', handleCreateTicket);

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

  // Error handling middleware
  app.use((err: any, _req: Request, res: Response, _next: NextFunction) => {
    const status = err.status || 500;
    res.status(status).json({
      error: err.message || 'Internal Server Error',
    });
  });

  return app;
}
