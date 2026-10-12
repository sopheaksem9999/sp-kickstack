import { describe, it, expect } from 'vitest';
import {
  QUEUE_TABS,
  VALID_QUEUE_TABS,
  filterQueue,
  matchesTab,
  resolveQueueTab,
  sortQueue,
  tabCounts,
} from './queueTasks';

let nextId = 1;
const task = (extra: Record<string, unknown> = {}) =>
  ({
    id: nextId++,
    req_id: 'REQ-001',
    req_title: 'Ride tracking',
    project: 'backend',
    role: 'goal',
    status: 'queued',
    title: 'Build the endpoint',
    engine_task_id: null,
    branch: null,
    updated_at: '2026-10-12T10:00:00.000Z',
    ...extra,
  }) as any;

describe('queue tabs', () => {
  it('lists the five tabs in screen order with labels', () => {
    expect(VALID_QUEUE_TABS).toEqual(['all', 'queued', 'running', 'failed', 'done']);
    expect(QUEUE_TABS.map((t) => t.id)).toEqual(VALID_QUEUE_TABS);
    expect(QUEUE_TABS.map((t) => t.label)).toEqual(['All Tasks', 'Queued', 'In Progress', 'Failed / Needs Human', 'Completed']);
  });

  it('falls back to "all" for a missing or unknown ?tab=', () => {
    expect(resolveQueueTab(null)).toBe('all');
    expect(resolveQueueTab('')).toBe('all');
    expect(resolveQueueTab('nope')).toBe('all');
    expect(resolveQueueTab('Queued')).toBe('all');
    for (const id of VALID_QUEUE_TABS) expect(resolveQueueTab(id)).toBe(id);
  });
});

describe('matchesTab', () => {
  it('puts each status in its tab', () => {
    expect(matchesTab(task({ status: 'pending' }), 'queued')).toBe(true);
    expect(matchesTab(task({ status: 'queued' }), 'queued')).toBe(true);
    expect(matchesTab(task({ status: 'running' }), 'running')).toBe(true);
    expect(matchesTab(task({ status: 'failed' }), 'failed')).toBe(true);
    expect(matchesTab(task({ status: 'needs_human' }), 'failed')).toBe(true);
    expect(matchesTab(task({ status: 'rate_limited' }), 'failed')).toBe(true);
    expect(matchesTab(task({ status: 'done' }), 'done')).toBe(true);
  });

  it('keeps other statuses out of the specific tabs, and every status in "all"', () => {
    for (const status of ['held', 'in_review', 'qa', 'cancelled']) {
      for (const tab of ['queued', 'running', 'failed', 'done'] as const) {
        expect(matchesTab(task({ status }), tab)).toBe(false);
      }
      expect(matchesTab(task({ status }), 'all')).toBe(true);
    }
    expect(matchesTab(task({ status: 'running' }), 'queued')).toBe(false);
    expect(matchesTab(task({ status: 'done' }), 'failed')).toBe(false);
  });
});

describe('filterQueue', () => {
  const tasks = [
    task({ status: 'running', project: 'backend', title: 'Add login endpoint', req_id: 'REQ-001' }),
    task({ status: 'failed', project: 'mobile', title: 'Login screen', req_id: 'REQ-002', req_title: 'Sign in flow', branch: 'req/REQ-002/task-9' }),
    task({ status: 'done', project: 'mobile', title: 'Splash', req_id: 'REQ-003', engine_task_id: 'el-7Qx' }),
  ];
  const none = { tab: 'all' as const, project: null, search: '' };

  it('keeps everything without a filter', () => {
    expect(filterQueue(tasks, none)).toHaveLength(3);
  });

  it('filters by tab and by repository, and combines them', () => {
    expect(filterQueue(tasks, { ...none, tab: 'running' }).map((t) => t.title)).toEqual(['Add login endpoint']);
    expect(filterQueue(tasks, { ...none, project: 'mobile' })).toHaveLength(2);
    expect(filterQueue(tasks, { ...none, project: 'mobile', tab: 'done' }).map((t) => t.title)).toEqual(['Splash']);
  });

  it('searches title, requirement id and title, project, branch and engine id, ignoring case and spaces around', () => {
    const find = (search: string) => filterQueue(tasks, { ...none, search }).map((t) => t.title);
    expect(find('LOGIN')).toEqual(['Add login endpoint', 'Login screen']);
    expect(find('  req-003 ')).toEqual(['Splash']);
    expect(find('sign in')).toEqual(['Login screen']);
    expect(find('mobile')).toEqual(['Login screen', 'Splash']);
    expect(find('task-9')).toEqual(['Login screen']);
    expect(find('EL-7qx')).toEqual(['Splash']);
    expect(find('zzz')).toEqual([]);
  });

  it('tolerates tasks without a requirement title', () => {
    expect(filterQueue([task({ req_title: null })], { ...none, search: 'ride' })).toEqual([]);
  });
});

describe('tabCounts', () => {
  const tasks = [
    task({ status: 'pending', project: 'backend' }),
    task({ status: 'queued', project: 'backend' }),
    task({ status: 'running', project: 'mobile' }),
    task({ status: 'rate_limited', project: 'mobile', title: 'Paused work' }),
    task({ status: 'done', project: 'mobile' }),
    task({ status: 'held', project: 'mobile' }),
  ];

  it('counts what each tab would show', () => {
    expect(tabCounts(tasks, { project: null, search: '' })).toEqual({ all: 6, queued: 2, running: 1, failed: 1, done: 1 });
  });

  it('follows the repository and search filters, so a count matches the list behind it', () => {
    expect(tabCounts(tasks, { project: 'backend', search: '' })).toEqual({ all: 2, queued: 2, running: 0, failed: 0, done: 0 });
    expect(tabCounts(tasks, { project: null, search: 'paused' })).toEqual({ all: 1, queued: 0, running: 0, failed: 1, done: 0 });
  });
});

describe('sortQueue', () => {
  it('puts the most recently updated task first, newest id first on a tie, and leaves the input alone', () => {
    const a = task({ updated_at: '2026-10-12T09:00:00.000Z' });
    const b = task({ updated_at: '2026-10-12T11:00:00.000Z' });
    const c = task({ updated_at: '2026-10-12T11:00:00.000Z' });
    const input = [a, b, c];
    expect(sortQueue(input).map((t) => t.id)).toEqual([c.id, b.id, a.id]);
    expect(input.map((t) => t.id)).toEqual([a.id, b.id, c.id]);
  });
});
