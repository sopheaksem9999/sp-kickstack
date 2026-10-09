import { describe, it, expect, beforeEach } from 'vitest';
import { initDatabase, AppDatabase } from '../db/index.js';
import { ProjectService } from './projectService.js';
import { GitReviewService } from './gitReviewService.js';
import { createApp } from '../api/app.js';
import { testRequest } from '../api/testHelper.js';
import { WorkspaceService } from './workspaceService.js';
import { RequirementService } from './requirementService.js';
import { SettingsService } from './settingsService.js';
import { SseBroadcaster } from '../sse/broadcaster.js';
import { Notifier } from '../notify/notifier.js';
import { Express } from 'express';
import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';

describe('GitReviewService & Endpoints', () => {
  let db: AppDatabase;
  let projectService: ProjectService;
  let gitReviewService: GitReviewService;
  let app: Express;
  const tempRepo = path.join(process.cwd(), '.temp', 'test-git-review-repo');

  beforeEach(() => {
    // Setup temporary git repo
    if (fs.existsSync(tempRepo)) {
      fs.rmSync(tempRepo, { recursive: true, force: true });
    }
    fs.mkdirSync(tempRepo, { recursive: true });

    try {
      execSync('git init -b main', { cwd: tempRepo, stdio: 'ignore' });
      execSync('git config user.email "test@example.com"', { cwd: tempRepo, stdio: 'ignore' });
      execSync('git config user.name "Test Developer"', { cwd: tempRepo, stdio: 'ignore' });
      fs.writeFileSync(path.join(tempRepo, 'README.md'), '# Test Project\nLine 1\nLine 2\n');
      execSync('git add . && git commit -m "Initial commit on main"', { cwd: tempRepo, stdio: 'ignore' });

      // Create develop branch with changes
      execSync('git checkout -b develop', { cwd: tempRepo, stdio: 'ignore' });
      fs.writeFileSync(path.join(tempRepo, 'README.md'), '# Test Project\nLine 1\nLine 2 updated\nLine 3 added\n');
      fs.writeFileSync(path.join(tempRepo, 'new-file.ts'), 'export const hello = "world";\n');
      execSync('git add . && git commit -m "Feature commit on develop"', { cwd: tempRepo, stdio: 'ignore' });
    } catch {
      // In case git fails in sandbox, continue
    }

    db = initDatabase(':memory:');
    projectService = new ProjectService(db);
    gitReviewService = new GitReviewService(projectService);

    projectService.registerProject({
      name: 'sample-project',
      repo_path: tempRepo,
      engine_type: 'manual',
    });

    const workspaceService = new WorkspaceService(db);
    const requirementService = new RequirementService(db, '/tmp');
    const settingsService = new SettingsService(db);
    const broadcaster = new SseBroadcaster();
    const notifier = new Notifier();

    app = createApp({
      db,
      workspaceService,
      projectService,
      requirementService,
      settingsService,
      fanOutService: {} as any,
      linkService: {} as any,
      ticketService: {} as any,
      broadcaster,
      notifier,
    });
  });

  it('retrieves git review summary for a project', () => {
    const summary = gitReviewService.getReviewSummary('sample-project', 'main');
    expect(summary.project).toBe('sample-project');
    expect(summary.repoPath).toBe(tempRepo);
    expect(summary).toHaveProperty('changedFiles');
  });

  it('retrieves file diff for a changed file', () => {
    const diff = gitReviewService.getFileDiff('sample-project', 'README.md', 'main');
    expect(diff.path).toBe('README.md');
    expect(diff).toHaveProperty('diffLines');
    expect(diff).toHaveProperty('originalContent');
    expect(diff).toHaveProperty('modifiedContent');
  });

  it('scans file tree of the project repo', () => {
    const tree = gitReviewService.getFileTree('sample-project');
    expect(tree.type).toBe('directory');
    expect(tree.children?.some((c) => c.name === 'README.md')).toBe(true);
  });

  it('reads raw file content', () => {
    const file = gitReviewService.getFileContent('sample-project', 'README.md');
    expect(file.path).toBe('README.md');
    expect(file.content).toContain('Test Project');
  });

  it('GET /api/projects/:name/git-review/summary returns summary JSON', async () => {
    const res = await testRequest(app, 'GET', '/api/projects/sample-project/git-review/summary');
    expect(res.status).toBe(200);
    expect(res.body.project).toBe('sample-project');
  });

  it('GET /api/projects/:name/git-review/diff returns file diff JSON', async () => {
    const res = await testRequest(app, 'GET', '/api/projects/sample-project/git-review/diff?file=README.md');
    expect(res.status).toBe(200);
    expect(res.body.path).toBe('README.md');
  });

  it('GET /api/projects/:name/git-review/tree returns directory tree JSON', async () => {
    const res = await testRequest(app, 'GET', '/api/projects/sample-project/git-review/tree');
    expect(res.status).toBe(200);
    expect(res.body.type).toBe('directory');
  });
});
