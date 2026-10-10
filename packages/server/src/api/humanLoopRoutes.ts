import type { Express, RequestHandler } from 'express';
import { AskQuestionInputSchema, QuestionStatus } from '@sp-kickstack/shared';
import { badRequest } from '../lib/httpError.js';
import type { QuestionService } from '../services/questionService.js';

export interface HumanLoopRouteDeps {
  questionService: QuestionService;
  requireAgentToken: RequestHandler;
}

const QUESTION_STATUSES: QuestionStatus[] = ['open', 'answered', 'cancelled'];

/** Routes for people and agents talking to each other: questions, review comments, notes, notifications. */
export function registerHumanLoopRoutes(app: Express, deps: HumanLoopRouteDeps) {
  const { questionService } = deps;

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
}
