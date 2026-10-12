// A requirement only targets repositories of its own workspace.
import { describe, it, expect, beforeEach, afterEach, afterAll } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { initDatabase, AppDatabase } from '../db/index.js';
import { RequirementService } from './requirementService.js';
import { ProjectService } from './projectService.js';
import { AiChatService } from './aiChatService.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const tempWorkspace = path.resolve(__dirname, '../../.temp/sp-test-workspace-scope');

describe('Repositories are scoped to the requirement workspace', () => {
  let db: AppDatabase;
  let requirements: RequirementService;

  const create = (affected_projects: string[]) =>
    requirements.createRequirement({
      workspace_id: 'speedx', title: 'T', goal: 'g', acceptance_criteria: ['a'], affected_projects, priority: 'normal',
    });

  beforeEach(() => {
    fs.rmSync(tempWorkspace, { recursive: true, force: true });
    db = initDatabase(':memory:');
    requirements = new RequirementService(db, tempWorkspace);
    db.exec(`
      INSERT INTO workspaces (id, name, created_at, updated_at) VALUES ('speedx', 'Speedx', 'x', 'x'), ('cg', 'CG', 'x', 'x');
      INSERT INTO projects (name, workspace_id, repo_path, engine_type, created_at, updated_at) VALUES
        ('backend', 'speedx', '/r/b', 'manual', 'x', 'x'),
        ('frontend', 'speedx', '/r/f', 'manual', 'x', 'x'),
        ('api', 'cg', '/r/a', 'manual', 'x', 'x'),
        ('mobile app', 'cg', '/r/m', 'manual', 'x', 'x');
    `);
  });

  afterEach(() => db.close());
  afterAll(() => fs.rmSync(tempWorkspace, { recursive: true, force: true }));

  it('drops repositories of other workspaces when a requirement is created', () => {
    const req = create(['backend', 'frontend', 'api', 'mobile app']);

    expect([...req.affected_projects].sort()).toEqual(['backend', 'frontend']);
    expect(fs.readFileSync(req.file_path, 'utf-8')).not.toContain('mobile app');
  });

  it('refuses when every chosen repository belongs to another workspace, and says what to pick', () => {
    expect(() => create(['api', 'mobile app'])).toThrow(/another workspace.*backend, frontend/);
    expect(() => create(['api'])).toThrow(expect.objectContaining({ status: 400 }));
  });

  it('applies the same rule when the repositories are edited', () => {
    const req = create(['backend']);

    const updated = requirements.updateRequirementProjects(req.id, ['backend', 'frontend', 'api'])!;

    expect([...updated.affected_projects].sort()).toEqual(['backend', 'frontend']);
    expect(() => requirements.updateRequirementProjects(req.id, ['api'])).toThrow(/another workspace/);
  });

  it("gives the AI architect only the workspace's own projects", () => {
    const context = new AiChatService(db, new ProjectService(db)).compileWorkspaceContext('speedx');

    expect(context).toContain('**backend**');
    expect(context).toContain('**frontend**');
    expect(context).not.toContain('**api**');
    expect(context).not.toContain('**mobile app**');
  });
});
