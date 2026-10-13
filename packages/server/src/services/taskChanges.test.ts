// The files a task changed on its branch (against the branch it started from) and one file's diff.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { initDatabase, type AppDatabase } from '../db/index.js';
import { ProjectService } from './projectService.js';
import { RequirementService } from './requirementService.js';
import { FanOutService } from './fanOutService.js';
import { LinkService } from './linkService.js';
import { TicketService } from './ticketService.js';
import { WorkspaceService } from './workspaceService.js';
import { ReviewService } from './reviewService.js';
import { ManualAdapter } from '../adapters/manualAdapter.js';
import { TaskChangesService, parseUnifiedDiff } from './taskChanges.js';
import { makeRepo, commitOnBranch, sh } from '../testing/gitFixture.js';
import { createApp } from '../api/app.js';
import { testRequest } from '../api/testHelper.js';
import { SseBroadcaster } from '../sse/broadcaster.js';
import { Notifier } from '../notify/notifier.js';

let ws: string;
let db: AppDatabase;
let repo: string;
let reqId: string;
let goalId: number;
const changes = () => new TaskChangesService(db);

beforeEach(() => {
  ws = fs.mkdtempSync(path.join(os.tmpdir(), 'sp-task-changes-'));
  repo = makeRepo(path.join(ws, 'backend')).repo;
  db = initDatabase(':memory:');
  const requirements = new RequirementService(db, ws);
  new ProjectService(db).registerProject({ name: 'backend', repo_path: repo, engine_type: 'manual', base_branch: 'develop' });
  reqId = requirements.createRequirement({ title: 'T', goal: 'g', acceptance_criteria: ['a'], affected_projects: ['backend'], priority: 'normal' }).id;

  commitOnBranch(repo, 'develop', 'old.txt', 'gone soon\n');
  commitOnBranch(repo, 'develop', 'keep.txt', 'same text\n');
  sh(repo, ['branch', reqId]);
  const wt = path.join(ws, 'wt');
  sh(repo, ['worktree', 'add', '-q', wt, reqId]);
  fs.mkdirSync(path.join(wt, 'src'));
  fs.writeFileSync(path.join(wt, 'src/new.ts'), 'export const a = 1;\nexport const b = 2;\n');
  fs.writeFileSync(path.join(wt, 'README.md'), '# repo\nmore\n');
  fs.writeFileSync(path.join(wt, 'img.png'), Buffer.from([0x89, 0x50, 0x4e, 0x47, 0, 0, 1, 2]));
  sh(wt, ['rm', '-q', 'old.txt']);
  sh(wt, ['mv', 'keep.txt', 'moved.txt']);
  sh(wt, ['add', '-A']);
  sh(wt, ['commit', '-q', '-m', 'agent work']);
  sh(repo, ['worktree', 'remove', '--force', wt]);
  commitOnBranch(repo, 'develop', 'develop-only.txt', 'not part of the task\n');

  goalId = Number(
    db
      .prepare("INSERT INTO bridge_tasks (req_id, project, role, title, status, branch, created_at, updated_at) VALUES (?, 'backend', 'goal', 'T', 'in_review', ?, 'x', 'x')")
      .run(reqId, reqId).lastInsertRowid
  );
});
afterEach(() => {
  db.close();
  fs.rmSync(ws, { recursive: true, force: true });
});

describe('Files a task changed on its branch', () => {
  it('lists added, modified, deleted, renamed and binary files with line counts, not later base commits', () => {
    expect(changes().changes(goalId)).toEqual({
      branch: reqId,
      base: 'develop',
      files: [
        { path: 'img.png', status: 'A', additions: 0, deletions: 0, binary: true },
        { path: 'moved.txt', oldPath: 'keep.txt', status: 'R', additions: 0, deletions: 0, binary: false },
        { path: 'old.txt', status: 'D', additions: 0, deletions: 1, binary: false },
        { path: 'README.md', status: 'M', additions: 1, deletions: 0, binary: false },
        { path: 'src/new.ts', status: 'A', additions: 2, deletions: 0, binary: false },
      ],
      additions: 3,
      deletions: 1,
      truncated: false,
    });
  });

  it("shows one file's diff with line numbers; a rename without edits and a binary file have no lines", () => {
    expect(changes().fileDiff(goalId, 'src/new.ts')).toEqual({
      path: 'src/new.ts',
      binary: false,
      truncated: false,
      lines: [
        { type: 'hunk', text: '@@ -0,0 +1,2 @@' },
        { type: 'add', text: 'export const a = 1;', newLine: 1 },
        { type: 'add', text: 'export const b = 2;', newLine: 2 },
      ],
    });
    expect(changes().fileDiff(goalId, 'README.md').lines.slice(1)).toEqual([
      { type: 'context', text: '# repo', oldLine: 1, newLine: 1 },
      { type: 'add', text: 'more', newLine: 2 },
    ]);
    expect(changes().fileDiff(goalId, 'moved.txt')).toMatchObject({ binary: false, lines: [] });
    expect(changes().fileDiff(goalId, 'img.png')).toMatchObject({ binary: true, lines: [] });
  });

  it('refuses paths outside the repository, files the task did not change and unknown tasks', () => {
    expect(() => changes().fileDiff(goalId, '../etc/passwd')).toThrow('relative to the repository');
    expect(() => changes().fileDiff(goalId, 'develop-only.txt')).toThrow(`develop-only.txt is not changed on ${reqId}`);
    expect(() => changes().changes(999999)).toThrow('Task #999999 not found');
    const loose = Number(
      db
        .prepare("INSERT INTO bridge_tasks (req_id, project, role, title, status, created_at, updated_at) VALUES (?, 'backend', 'ticket', 'T', 'queued', 'x', 'x')")
        .run(reqId).lastInsertRowid
    );
    expect(changes().changes(loose)).toEqual({ branch: null, base: 'develop', files: [], additions: 0, deletions: 0, truncated: false });
  });

  it('answers GET /api/tasks/:id/changes and /changes/diff', async () => {
    const getAdapter = () => new ManualAdapter() as any;
    const projectService = new ProjectService(db);
    const requirementService = new RequirementService(db, ws);
    const linkService = new LinkService(db, projectService, getAdapter);
    const ticketService = new TicketService(db, projectService, linkService, getAdapter);
    const fanOutService = new FanOutService(db, projectService, requirementService, getAdapter);
    const app = createApp({
      db, workspaceService: new WorkspaceService(db), projectService, requirementService, fanOutService, linkService, ticketService,
      broadcaster: new SseBroadcaster(), notifier: new Notifier(), reviewService: new ReviewService(db, requirementService, fanOutService, ticketService, getAdapter),
    });
    expect((await testRequest(app, 'GET', `/api/tasks/${goalId}/changes`)).body.files).toHaveLength(5);
    const diff = await testRequest(app, 'GET', `/api/tasks/${goalId}/changes/diff?file=src%2Fnew.ts`);
    expect(diff.body.lines).toHaveLength(3);
    expect((await testRequest(app, 'GET', `/api/tasks/${goalId}/changes/diff?file=nope.txt`)).status).toBe(404);
    expect((await testRequest(app, 'GET', `/api/tasks/${goalId}/changes/diff`)).status).toBe(400);
  });
});

describe('Unified diff parsing', () => {
  it('stops at the line limit and says so', () => {
    const text = ['diff --git a/x b/x', '--- a/x', '+++ b/x', '@@ -1,3 +1,3 @@', ' a', '-b', '+c', ' d'].join('\n');
    expect(parseUnifiedDiff(text, 3)).toEqual({
      binary: false,
      truncated: true,
      lines: [
        { type: 'hunk', text: '@@ -1,3 +1,3 @@' },
        { type: 'context', text: 'a', oldLine: 1, newLine: 1 },
        { type: 'del', text: 'b', oldLine: 2 },
      ],
    });
  });
});
