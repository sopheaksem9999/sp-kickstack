import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { initDatabase } from '../db/index.js';
import { SettingsService } from '../services/settingsService.js';
import { Notifier } from './notifier.js';
import { NotificationService, describeEvent } from './notificationService.js';
import { TaskReactor } from '../services/taskReactor.js';
import { RequirementService } from '../services/requirementService.js';
import { ProjectService } from '../services/projectService.js';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

type Post = { url: string; body: any; signal?: AbortSignal };

function makeHarness() {
  const db = initDatabase(':memory:');
  const settings = new SettingsService(db);
  const posts: Post[] = [];
  const failing = new Set<string>();
  // Per-URL outcome: an error to throw or an HTTP status to answer with (checked after `failing`).
  const outcomes = new Map<string, Error | number>();
  // Node's fetch throws a TypeError('fetch failed') and keeps the real reason in `cause`.
  const nodeError = (message: string, code: string) =>
    Object.assign(new TypeError('fetch failed'), { cause: Object.assign(new Error(message), { code }) });
  const fetchImpl = (async (url: any, init?: any) => {
    posts.push({ url: String(url), body: JSON.parse(init.body), signal: init.signal });
    if (failing.has(String(url))) throw nodeError('connect ECONNREFUSED 127.0.0.1:9', 'ECONNREFUSED');
    const outcome = outcomes.get(String(url));
    if (outcome instanceof Error) throw outcome;
    if (typeof outcome === 'number') return new Response('nope', { status: outcome });
    return new Response('ok', { status: 200 });
  }) as typeof fetch;
  const service = new NotificationService(db, settings, new Notifier([], fetchImpl));
  const event = (type: string, payload: Record<string, unknown>, reqId: string | null = 'REQ-001') =>
    db.prepare('INSERT INTO events (req_id, task_id, type, payload, read, at) VALUES (?, NULL, ?, ?, 0, ?)').run(reqId, type, JSON.stringify(payload), new Date().toISOString());
  const channels = [
    { id: 'team', type: 'slack' as const, name: 'Team', url: 'https://hooks.slack.test/a', enabled: true },
    { id: 'off', type: 'webhook' as const, name: 'Off', url: 'https://hooks.test/off', enabled: false },
  ];
  return { db, settings, service, posts, failing, outcomes, nodeError, event, channels };
}

describe('Notification delivery', () => {
  let h: ReturnType<typeof makeHarness>;
  beforeEach(() => { h = makeHarness(); });
  afterEach(() => h.db.close());

  it('starts at the end of the event log instead of replaying history', async () => {
    h.settings.updateNotificationSettings({ channels: h.channels });
    h.event('question_asked', { project: 'mobile', question: 'Old question?' });

    expect(await h.service.dispatchPending()).toBe(0);
    expect(h.posts).toEqual([]);

    h.event('question_asked', { project: 'mobile', question: 'New question?' });
    expect(await h.service.dispatchPending()).toBe(1);
    expect(await h.service.dispatchPending()).toBe(0);
    expect(h.posts).toHaveLength(1);
  });

  it('sends enabled events to enabled channels with a link to the requirement', async () => {
    await h.service.dispatchPending();
    h.settings.updateNotificationSettings({ channels: h.channels, app_url: 'http://localhost:4101/' });
    h.event('question_asked', { project: 'mobile', question: 'Redis or Postgres?', options: ['redis', 'postgres'] });
    h.event('task_status_changed', { newStatus: 'running' });
    h.event('changes_requested', { reqId: 'REQ-001', round: 1, taskIds: [1] });

    expect(await h.service.dispatchPending()).toBe(1);

    expect(h.posts).toHaveLength(1);
    expect(h.posts[0].url).toBe('https://hooks.slack.test/a');
    expect(h.posts[0].body.text).toContain('mobile agent asks a question');
    expect(h.posts[0].body.text).toContain('Options: redis / postgres');
    expect(h.posts[0].body.text).toContain('http://localhost:4101/requirements/REQ-001');
    expect(h.posts[0].signal).toBeDefined();
  });

  it('moves on without channels and honours per-event switches', async () => {
    await h.service.dispatchPending();
    h.event('merge_failed', { reqId: 'REQ-001', error: 'conflict in a.ts\nmore' });
    expect(await h.service.dispatchPending()).toBe(0);

    h.settings.updateNotificationSettings({ channels: h.channels, events: { merge_failed: false } });
    h.event('merge_failed', { reqId: 'REQ-001', error: 'again' });
    expect(await h.service.dispatchPending()).toBe(0);
    expect(h.posts).toEqual([]);
  });

  it('skips a failing channel and still reaches the others', async () => {
    await h.service.dispatchPending();
    h.failing.add('https://hooks.slack.test/a');
    h.settings.updateNotificationSettings({
      channels: [h.channels[0], { id: 'hook', type: 'webhook', name: 'Hook', url: 'https://hooks.test/b', enabled: true }],
    });
    h.event('task_failed', { project: 'backend', error: 'boom' });

    expect(await h.service.dispatchPending()).toBe(1);
    expect(h.posts.map((p) => p.url).sort()).toEqual(['https://hooks.slack.test/a', 'https://hooks.test/b']);
    expect(h.posts.find((p) => p.url === 'https://hooks.test/b')!.body).toMatchObject({ type: 'task_failed', title: 'A backend task failed (REQ-001)' });
  });

  it('a malformed event never stalls later ones', async () => {
    await h.service.dispatchPending();
    h.settings.updateNotificationSettings({ channels: h.channels });
    h.event('engine_rate_limited', { project: 'backend', until: 'not a date' }, null);
    h.db.prepare("INSERT INTO events (req_id, task_id, type, payload, read, at) VALUES (NULL, NULL, 'task_failed', 'not json', 0, ?)").run(new Date().toISOString());
    h.event('merge_failed', { reqId: 'REQ-001', error: 'conflict' });

    expect(await h.service.dispatchPending()).toBe(3);
    expect(h.posts[0].body.text).toContain('backend engine is rate limited');
    expect(h.posts[0].body.text).not.toContain(' at ');
    expect(h.posts[2].body.text).toContain('Merge failed for REQ-001');
    expect(await h.service.dispatchPending()).toBe(0);
  });

  it('sends a test message and reports each channel', async () => {
    h.failing.add('https://hooks.test/b');
    h.settings.updateNotificationSettings({
      channels: [h.channels[0], { id: 'hook', type: 'webhook', name: 'Hook', url: 'https://hooks.test/b', enabled: true }],
    });

    const results = await h.service.sendTest();
    expect(results).toEqual([
      { channel: 'Team', ok: true },
      { channel: 'Hook', ok: false, error: 'The host refused the connection. Check the URL and port.' },
    ]);
    expect(await h.service.sendTest('off-or-missing').catch((e) => e.status)).toBe(404);
  });

  it('explains each kind of delivery failure in plain words, without the full URL', async () => {
    const url = (id: string) => `https://hooks.example.test/services/${id}/SECRET-TOKEN`;
    const ids = ['slow', 'missing', 'gone', 'odd', 'weird'];
    h.settings.updateNotificationSettings({
      channels: ids.map((id) => ({ id, type: 'webhook' as const, name: id, url: url(id), enabled: true })),
    });
    h.outcomes.set(url('slow'), Object.assign(new Error('The operation was aborted due to timeout'), { name: 'TimeoutError' }));
    h.outcomes.set(url('missing'), 404);
    h.outcomes.set(url('gone'), h.nodeError('getaddrinfo ENOTFOUND hooks.example.test', 'ENOTFOUND'));
    h.outcomes.set(url('odd'), h.nodeError('certificate has expired', 'CERT_HAS_EXPIRED'));
    h.outcomes.set(url('weird'), new Error(`boom while posting to ${url('weird')}`));

    const results = await h.service.sendTest();
    expect(results).toEqual([
      { channel: 'slow', ok: false, error: 'No answer within 10 seconds. Check the URL and that the service is reachable.' },
      { channel: 'missing', ok: false, error: 'The service answered HTTP 404. Check the URL (and the token or chat id in it).' },
      { channel: 'gone', ok: false, error: 'Could not find the host hooks.example.test. Check the URL.' },
      { channel: 'odd', ok: false, error: 'Could not reach the URL (CERT_HAS_EXPIRED). Check it and your network.' },
      { channel: 'weird', ok: false, error: 'Could not reach the URL (boom while posting to hooks.example.test). Check it and your network.' },
    ]);
    expect(JSON.stringify(results)).not.toContain('SECRET-TOKEN');
  });

  it('treats an aborted request as a timeout', async () => {
    h.settings.updateNotificationSettings({ channels: [h.channels[0]] });
    h.outcomes.set(h.channels[0].url, Object.assign(new Error('This operation was aborted'), { name: 'AbortError' }));
    expect(await h.service.sendTest('team')).toEqual([
      { channel: 'Team', ok: false, error: 'No answer within 10 seconds. Check the URL and that the service is reachable.' },
    ]);
  });

  it('validates and merges notification settings', () => {
    expect(h.settings.getNotificationSettings()).toMatchObject({ channels: [], app_url: '', events: { question_asked: true, changes_requested: false } });
    expect(() => h.settings.updateNotificationSettings({ channels: [{ ...h.channels[0], url: 'ftp://x' }] })).toThrow();
    expect(() => h.settings.updateNotificationSettings({ events: { nope: true } })).toThrow(/Unknown notification event/);
    expect(() => h.settings.updateNotificationSettings({ channels: [h.channels[0], h.channels[0]] })).toThrow(/unique/);
    const updated = h.settings.updateNotificationSettings({ events: { changes_requested: true } });
    expect(updated.events).toMatchObject({ changes_requested: true, question_asked: true });
  });

  it('describes every notifiable event in plain words', () => {
    const cases: Array<[string, Record<string, unknown>, RegExp]> = [
      ['task_needs_human', { project: 'mobile', summary: 'Which DB?' }, /mobile agent needs help[\s\S]*Which DB\?/],
      ['requirement_in_review', { reqId: 'REQ-001' }, /REQ-001 is ready for review/],
      ['merge_succeeded', { reqId: 'REQ-001', warnings: [] }, /REQ-001 merged and moved to QA/],
      ['merge_failed', { reqId: 'REQ-001', error: 'conflict\nmore' }, /Merge failed for REQ-001[\s\S]*conflict/],
      ['task_blocked', { reason: 'release failed' }, /blocked[\s\S]*release failed/],
      ['engine_down', { project: 'backend' }, /backend engine is down/],
      ['engine_rate_limited', { project: 'backend', until: '2026-10-10T10:00:00.000Z' }, /backend engine is rate limited[\s\S]*2026-10-10T10:00/],
      ['changes_requested', { reqId: 'REQ-001', round: 2, taskIds: [1, 2] }, /Changes requested on REQ-001[\s\S]*Round 2/],
      ['question_answered', { answer: 'redis' }, /Question answered[\s\S]*redis/],
    ];
    for (const [type, payload, pattern] of cases) {
      const text = describeEvent({ type, req_id: 'REQ-001', payload });
      expect(text, type).not.toBeNull();
      expect(`${text!.title}\n${text!.message}`, type).toMatch(pattern);
    }
    expect(describeEvent({ type: 'task_updated', req_id: null, payload: {} })).toBeNull();
  });
});

describe('Events that need a person', () => {
  it('records requirement_in_review and task_needs_human with the engine summary', async () => {
    const db = initDatabase(':memory:');
    const ws = fs.mkdtempSync(path.join(os.tmpdir(), 'sp-notify-'));
    const requirementService = new RequirementService(db, ws);
    new ProjectService(db).registerProject({
      name: 'backend', kind: 'backend', repo_path: ws, engine_type: 'manual', base_branch: 'develop', enabled: true,
    });
    const req = requirementService.createRequirement({ title: 'T', goal: 'g', acceptance_criteria: ['a'], affected_projects: ['backend'], priority: 'normal' });
    requirementService.updateStatus(req.id, 'in_progress');
    db.prepare(`
      INSERT INTO bridge_tasks (id, req_id, project, role, engine_task_id, title, status, revision, created_at, updated_at)
      VALUES (1, ?, 'backend', 'goal', 'e-1', 't', 'running', 1, 'x', 'x')
    `).run(req.id);
    const reactor = new TaskReactor(db, requirementService);
    const task = db.prepare('SELECT * FROM bridge_tasks WHERE id = 1').get() as any;

    db.prepare("UPDATE bridge_tasks SET status = 'needs_human' WHERE id = 1").run();
    await reactor.onTaskStatusChanged(task, 'running', 'needs_human', 'watcher', { summary: 'Which DB should I use?' });
    db.prepare("UPDATE bridge_tasks SET status = 'in_review' WHERE id = 1").run();
    await reactor.onTaskStatusChanged({ ...task, status: 'needs_human' }, 'needs_human', 'in_review', 'watcher');

    const rows = db.prepare('SELECT type, payload FROM events ORDER BY id').all() as Array<{ type: string; payload: string }>;
    const needs = rows.find((r) => r.type === 'task_needs_human')!;
    expect(JSON.parse(needs.payload)).toMatchObject({ taskId: 1, project: 'backend', summary: 'Which DB should I use?' });
    expect(rows.filter((r) => r.type === 'requirement_in_review')).toHaveLength(1);
    db.close();
    fs.rmSync(ws, { recursive: true, force: true });
  });
});

describe('Notification settings API', () => {
  it('reads, saves and tests notification settings', async () => {
    const h = makeHarness();
    const { createApp } = await import('../api/app.js');
    const { testRequest } = await import('../api/testHelper.js');
    const { WorkspaceService } = await import('../services/workspaceService.js');
    const { RequirementService: Req } = await import('../services/requirementService.js');
    const { LinkService } = await import('../services/linkService.js');
    const { TicketService } = await import('../services/ticketService.js');
    const { FanOutService } = await import('../services/fanOutService.js');
    const { SseBroadcaster } = await import('../sse/broadcaster.js');
    const projectService = new ProjectService(h.db);
    const requirementService = new Req(h.db, fs.mkdtempSync(path.join(os.tmpdir(), 'sp-notify-api-')));
    const noAdapters = () => { throw new Error('no engines in this test'); };
    const linkService = new LinkService(h.db, projectService, noAdapters as any);
    const app = createApp({
      db: h.db, workspaceService: new WorkspaceService(h.db), projectService, requirementService,
      fanOutService: new FanOutService(h.db, projectService, requirementService, noAdapters as any), linkService,
      ticketService: new TicketService(h.db, projectService, linkService, noAdapters as any),
      broadcaster: new SseBroadcaster(), notifier: new Notifier(), settingsService: h.settings, notificationService: h.service,
    });

    expect((await testRequest(app, 'GET', '/api/settings/notifications')).body.events.question_asked).toBe(true);
    const saved = await testRequest(app, 'PUT', '/api/settings/notifications', { body: { channels: [h.channels[0]] } });
    expect(saved.status).toBe(200);
    expect(saved.body.channels).toHaveLength(1);
    expect((await testRequest(app, 'PUT', '/api/settings/notifications', { body: { channels: [{ ...h.channels[0], url: 'nope' }] } })).status).toBe(400);
    const tested = await testRequest(app, 'POST', '/api/settings/notifications/test', { body: { channel_id: 'team' } });
    expect(tested.body).toEqual([{ channel: 'Team', ok: true }]);
    h.db.close();
  });
});
