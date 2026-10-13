// Files attached to review comments: kept on disk next to the workspace, given to the agent by path.
import { describe, it, expect, beforeEach, afterEach, afterAll } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { initDatabase } from '../db/index.js';
import { ProjectService } from './projectService.js';
import { RequirementService } from './requirementService.js';
import { FanOutService } from './fanOutService.js';
import { LinkService } from './linkService.js';
import { TicketService } from './ticketService.js';
import { TaskReactor } from './taskReactor.js';
import { ReviewService } from './reviewService.js';
import { WorkspaceService } from './workspaceService.js';
import { EngineWatcher } from '../watcher/engineWatcher.js';
import { FakeEngineServer } from '../adapters/fakeEngine.js';
import { StoneforgeAdapter } from '../adapters/stoneforgeAdapter.js';
import { createApp } from '../api/app.js';
import { testRequest } from '../api/testHelper.js';
import { SseBroadcaster } from '../sse/broadcaster.js';
import { Notifier } from '../notify/notifier.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const tempRoot = path.resolve(__dirname, '../../.temp/sp-test-review-attachments');
let n = 0;

const dataUrl = (type: string, text: string) => `data:${type};base64,${Buffer.from(text).toString('base64')}`;
const PNG = { name: 'shot.png', type: 'image/png', data_url: dataUrl('image/png', 'PNGDATA') };
const LOG = { name: '../error log.txt', type: 'text/plain', data_url: dataUrl('text/plain', 'boom!') };

function makeHarness() {
  const ws = path.join(tempRoot, `case-${process.pid}-${n++}`);
  fs.mkdirSync(path.join(ws, 'backend'), { recursive: true });
  const db = initDatabase(':memory:');
  const projectService = new ProjectService(db);
  const requirementService = new RequirementService(db, ws);
  const engine = new FakeEngineServer('http://127.0.0.1:3457');
  const adapter = new StoneforgeAdapter('http://127.0.0.1:3457', path.join(ws, 'backend'), undefined, ((u: any, i?: any) => engine.fetch(u, i)) as typeof fetch);
  const getAdapter = () => adapter;
  const linkService = new LinkService(db, projectService, getAdapter);
  const ticketService = new TicketService(db, projectService, linkService, getAdapter);
  const fanOutService = new FanOutService(db, projectService, requirementService, getAdapter);
  const reactor = new TaskReactor(db, requirementService, linkService);
  const watcher = new EngineWatcher(db, projectService, requirementService, getAdapter, undefined, 5000, reactor);
  const review = new ReviewService(db, requirementService, fanOutService, ticketService, getAdapter);
  projectService.registerProject({
    name: 'backend', kind: 'backend', repo_path: path.join(ws, 'backend'), engine_type: 'stoneforge',
    engine_url: 'http://127.0.0.1:3457', base_branch: 'develop', enabled: true,
  });
  const inReview = async () => {
    const req = requirementService.createRequirement({ title: 'T', goal: 'g', acceptance_criteria: ['a'], affected_projects: ['backend'], priority: 'normal' });
    const [goal] = await fanOutService.execute(req.id);
    engine.setTaskStatus(goal.engine_task_id!, 'in_review', 'review');
    await watcher.scanOnce();
    return { req, goal };
  };
  const filesDir = (reqId: string, commentId: number) => path.resolve(ws, 'review-attachments', reqId, String(commentId));
  const prompt = (taskId: number) => {
    const row = db.prepare('SELECT engine_task_id FROM bridge_tasks WHERE id = ?').get(taskId) as { engine_task_id: string };
    return engine.getTaskData(row.engine_task_id)!.notes[0] as string;
  };
  const app = () =>
    createApp({
      db, workspaceService: new WorkspaceService(db), projectService, requirementService, fanOutService, linkService, ticketService,
      broadcaster: new SseBroadcaster(), notifier: new Notifier(), getAdapter, reviewService: review,
    });
  return { db, review, inReview, filesDir, prompt, app };
}

type H = ReturnType<typeof makeHarness>;
afterAll(() => fs.rmSync(tempRoot, { recursive: true, force: true }));

describe('Review comment attachments', () => {
  let h: H;
  beforeEach(() => { h = makeHarness(); });
  afterEach(() => h.db.close());

  it('keeps the files with the comment, lists them and finds each one by name only', async () => {
    const { req, goal } = await h.inReview();
    const comment = h.review.addComment(req.id, { task_id: goal.id, body: 'See the screenshot', attachments: [PNG, LOG] });

    const expected = [
      { name: 'error log.txt', size: 5, type: 'text/plain' },
      { name: 'shot.png', size: 7, type: 'image/png' },
    ];
    expect(comment.attachments).toEqual(expected);
    expect(h.review.listComments(req.id)[0].attachments).toEqual(expected);
    const dir = h.filesDir(req.id, comment.id);
    expect(fs.readFileSync(path.join(dir, 'shot.png'), 'utf8')).toBe('PNGDATA');
    expect(h.review.attachmentFile(comment.id, 'shot.png')).toBe(path.join(dir, 'shot.png'));
    expect(() => h.review.attachmentFile(comment.id, '../shot.png')).toThrow('not found');
    expect(() => h.review.attachmentFile(comment.id, 'nope.png')).toThrow('not found');
  });

  it('refuses an attachment without file data, and keeps nothing', async () => {
    const { req, goal } = await h.inReview();
    expect(() => h.review.addComment(req.id, { task_id: goal.id, body: 'x', attachments: [{ name: 'a.png', data_url: 'not-data' }] })).toThrow(
      'Attachment a.png has no file data'
    );
    expect(h.review.listComments(req.id)).toEqual([]);
    expect(fs.existsSync(path.dirname(h.filesDir(req.id, 1)))).toBe(false);
  });

  it('deleting an open comment deletes its files', async () => {
    const { req, goal } = await h.inReview();
    const comment = h.review.addComment(req.id, { task_id: goal.id, body: 'x', attachments: [PNG] });
    h.review.deleteComment(comment.id);
    expect(fs.existsSync(h.filesDir(req.id, comment.id))).toBe(false);
  });

  it('tells the agent where each attached file is', async () => {
    const { req, goal } = await h.inReview();
    const comment = h.review.addComment(req.id, { task_id: goal.id, body: 'Fix the layout', attachments: [PNG, LOG] });
    await h.review.requestChanges(req.id);
    const dir = h.filesDir(req.id, comment.id);
    expect(h.prompt(goal.id)).toContain(
      `1. General — Fix the layout\n   Attached: \`${path.join(dir, 'error log.txt')}\` (text/plain)\n   Attached: \`${path.join(dir, 'shot.png')}\` (image/png)`
    );
  });

  it('takes attachments over the API and serves them back', async () => {
    const { req, goal } = await h.inReview();
    const app = h.app();
    const created = await testRequest(app, 'POST', `/api/requirements/${req.id}/comments`, { body: { task_id: goal.id, body: 'x', attachments: [PNG] } });
    expect(created.status).toBe(201);
    const file = await testRequest(app, 'GET', `/api/comments/${created.body.id}/attachments/shot.png`);
    expect(file.status).toBe(200);
    expect(file.headers['content-type']).toContain('image/png');
    expect((await testRequest(app, 'GET', `/api/comments/${created.body.id}/attachments/other.png`)).status).toBe(404);
  });
});
