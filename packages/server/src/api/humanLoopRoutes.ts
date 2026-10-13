import fs from 'node:fs';
import path from 'node:path';
import type { Express, RequestHandler } from 'express';
import { AskQuestionInputSchema, QuestionStatus } from '@sp-kickstack/shared';
import { badRequest } from '../lib/httpError.js';
import type { QuestionService } from '../services/questionService.js';
import type { QaService } from '../services/qaService.js';
import type { RequirementService } from '../services/requirementService.js';
import type { ReviewService } from '../services/reviewService.js';
import { attachmentType } from '../services/reviewAttachments.js';
import type { SettingsService } from '../services/settingsService.js';
import type { NotificationService } from '../notify/notificationService.js';
import type { SseBroadcaster } from '../sse/broadcaster.js';

export interface HumanLoopRouteDeps {
  questionService: QuestionService;
  qaService: QaService;
  reviewService: ReviewService;
  requirementService: RequirementService;
  settingsService: SettingsService;
  notificationService: NotificationService;
  broadcaster: SseBroadcaster;
  requireAgentToken: RequestHandler;
}

const QUESTION_STATUSES: QuestionStatus[] = ['open', 'answered', 'cancelled'];

/** Routes for people and agents talking to each other: questions, review comments, notes, notifications. */
export function registerHumanLoopRoutes(app: Express, deps: HumanLoopRouteDeps) {
  const { questionService, reviewService } = deps;

  app.post('/api/agent/questions', deps.requireAgentToken, async (req, res, next) => {
    try {
      const input = AskQuestionInputSchema.parse(req.body);
      const project = typeof req.body.project === 'string' && req.body.project ? req.body.project : 'unknown';
      const engineTaskId = typeof req.body.engineTaskId === 'string' ? req.body.engineTaskId : undefined;
      res.status(201).json(await questionService.ask(input, project, engineTaskId));
    } catch (err) {
      next(err);
    }
  });

  /** An agent's identity in a report: its repository and run (XTICKET_PROJECT / XTICKET_TASK). */
  const agentOf = (body: any) => ({
    project: typeof body?.project === 'string' && body.project ? body.project : 'unknown',
    runId: typeof body?.engineTaskId === 'string' ? body.engineTaskId : undefined,
  });

  app.post('/api/agent/qa/comments', deps.requireAgentToken, (req, res, next) => {
    try {
      const { project, runId } = agentOf(req.body);
      res.status(201).json(deps.qaService.addFinding(req.body, project, runId));
    } catch (err) {
      next(err);
    }
  });

  app.post('/api/agent/qa/result', deps.requireAgentToken, (req, res, next) => {
    try {
      const { project, runId } = agentOf(req.body);
      res.json(deps.qaService.recordResult(req.body, project, runId));
    } catch (err) {
      next(err);
    }
  });

  app.get('/api/requirements/:id/qa', (req, res, next) => {
    try {
      res.json(deps.qaService.status(req.params.id));
    } catch (err) {
      next(err);
    }
  });

  // "Run AI QA": every git repository of the requirement, at the tip of the branch it merged into.
  app.post('/api/requirements/:id/qa', (req, res, next) => {
    try {
      res.status(202).json(deps.qaService.start(req.params.id, 'manual'));
    } catch (err) {
      next(err);
    }
  });

  app.get('/api/questions', (req, res, next) => {
    try {
      const status = typeof req.query.status === 'string' ? (req.query.status as QuestionStatus) : undefined;
      if (status && !QUESTION_STATUSES.includes(status)) throw badRequest(`status must be one of ${QUESTION_STATUSES.join(', ')}`);
      const reqId = typeof req.query.req === 'string' ? req.query.req : undefined;
      res.json(questionService.list({ reqId, status }));
    } catch (err) {
      next(err);
    }
  });

  app.get('/api/requirements/:id/questions', (req, res) => {
    res.json(questionService.list({ reqId: req.params.id }));
  });

  app.post('/api/questions/:id/answer', async (req, res, next) => {
    try {
      res.json(await questionService.answer(Number(req.params.id), req.body ?? {}));
    } catch (err) {
      next(err);
    }
  });

  // Agent model / effort for a requirement's runs; undefined keeps a value, null clears it.
  app.put('/api/requirements/:id/agent-profile', (req, res, next) => {
    try {
      const updated = deps.requirementService.updateAgentProfile(req.params.id, req.body ?? {});
      deps.broadcaster.broadcast({ type: 'requirement_updated', payload: { id: updated.id } });
      res.json(updated);
    } catch (err) {
      next(err);
    }
  });

  app.get('/api/requirements/:id/comments', (req, res) => {
    res.json(reviewService.listComments(req.params.id));
  });

  app.post('/api/requirements/:id/comments', (req, res, next) => {
    try {
      res.status(201).json(reviewService.addComment(req.params.id, req.body ?? {}));
    } catch (err) {
      next(err);
    }
  });

  // "Improve with AI": a rewrite of the reviewer's draft; nothing is saved.
  app.post('/api/requirements/:id/comments/improve', async (req, res, next) => {
    try {
      res.json(await reviewService.improveComment(req.params.id, req.body ?? {}));
    } catch (err) {
      next(err);
    }
  });

  // Files a task changed on its branch (status, line counts) and one file's diff: the review card's "Changed files".
  app.get('/api/tasks/:id/changes', (req, res, next) => {
    try {
      res.json(reviewService.changes(Number(req.params.id)));
    } catch (err) {
      next(err);
    }
  });

  app.get('/api/tasks/:id/changes/diff', (req, res, next) => {
    try {
      res.json(reviewService.fileDiff(Number(req.params.id), typeof req.query.file === 'string' ? req.query.file : ''));
    } catch (err) {
      next(err);
    }
  });

  // Files changed on a task's branch: the "#" list of the review comment box.
  app.get('/api/tasks/:id/branch-files', (req, res, next) => {
    try {
      res.json(reviewService.branchFiles(Number(req.params.id)));
    } catch (err) {
      next(err);
    }
  });

  // A file attached to a review comment: photos and PDFs open in the browser, other files download.
  app.get('/api/comments/:id/attachments/:name', (req, res, next) => {
    try {
      const file = reviewService.attachmentFile(Number(req.params.id), req.params.name);
      const type = attachmentType(file);
      const inline = /^image\/(png|jpeg|gif|webp)$/.test(type) || type === 'application/pdf';
      res.type(type);
      res.setHeader('X-Content-Type-Options', 'nosniff');
      res.setHeader('Content-Disposition', `${inline ? 'inline' : 'attachment'}; filename*=UTF-8''${encodeURIComponent(path.basename(file))}`);
      res.send(fs.readFileSync(file));
    } catch (err) {
      next(err);
    }
  });

  app.patch('/api/comments/:id', (req, res, next) => {
    try {
      res.json(reviewService.updateComment(Number(req.params.id), req.body ?? {}));
    } catch (err) {
      next(err);
    }
  });

  app.delete('/api/comments/:id', (req, res, next) => {
    try {
      reviewService.deleteComment(Number(req.params.id));
      res.json({ ok: true });
    } catch (err) {
      next(err);
    }
  });

  app.post('/api/requirements/:id/request-changes', async (req, res, next) => {
    try {
      res.json(await reviewService.requestChanges(req.params.id, req.body ?? {}));
    } catch (err) {
      next(err);
    }
  });

  app.post('/api/tasks/:id/note', async (req, res, next) => {
    try {
      res.json(await reviewService.sendNote(Number(req.params.id), req.body ?? {}));
    } catch (err) {
      next(err);
    }
  });

  app.get('/api/settings/notifications', (_req, res) => {
    res.json(deps.settingsService.getNotificationSettings());
  });

  app.put('/api/settings/notifications', (req, res, next) => {
    try {
      const updated = deps.settingsService.updateNotificationSettings(req.body);
      deps.broadcaster.broadcast({ type: 'settings_updated', payload: { section: 'notifications' } });
      res.json(updated);
    } catch (err) {
      next(err);
    }
  });

  app.post('/api/settings/notifications/test', async (req, res, next) => {
    try {
      const channelId = typeof req.body?.channel_id === 'string' ? req.body.channel_id : undefined;
      res.json(await deps.notificationService.sendTest(channelId));
    } catch (err) {
      next(err);
    }
  });
}
