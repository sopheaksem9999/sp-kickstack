import { describe, it, expect } from 'vitest';
import { initDatabase } from '../db/index.js';
import { ProjectService } from './projectService.js';

describe('ProjectService test command', () => {
  it('stores, returns and clears a project test command', () => {
    const db = initDatabase(':memory:');
    const projects = new ProjectService(db);
    projects.registerProject({ name: 'backend', repo_path: '/r', engine_type: 'manual', test_command: 'npm ci && npm test' });
    expect(projects.getProject('backend')!.test_command).toBe('npm ci && npm test');

    projects.updateProject('backend', { test_command: null });
    expect(projects.getProject('backend')!.test_command ?? null).toBeNull();
    db.close();
  });
});

describe('ProjectService build and lint commands', () => {
  it('stores, returns and clears them', () => {
    const db = initDatabase(':memory:');
    const projects = new ProjectService(db);
    projects.registerProject({ name: 'backend', repo_path: '/r', engine_type: 'manual', build_command: 'npm run build', lint_command: 'npm run lint' });
    expect(projects.getProject('backend')).toMatchObject({ build_command: 'npm run build', lint_command: 'npm run lint' });

    projects.updateProject('backend', { lint_command: null });
    expect(projects.getProject('backend')!.lint_command ?? null).toBeNull();
    expect(projects.getProject('backend')!.build_command).toBe('npm run build');
    db.close();
  });
});
