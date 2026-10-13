// Requirement run settings: CLI, model, effort, target branch, merge policy.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { initDatabase, type AppDatabase } from '../db/index.js';
import { ProjectService } from './projectService.js';
import { RequirementService } from './requirementService.js';
import { SettingsService } from './settingsService.js';
import { RunStore } from '../localEngine/runStore.js';

let db: AppDatabase;
let requirements: RequirementService;
let ws: string;

beforeEach(() => {
  ws = fs.mkdtempSync(path.join(os.tmpdir(), 'sp-run-settings-'));
  db = initDatabase(':memory:');
  requirements = new RequirementService(db, ws);
  new ProjectService(db).registerProject({ name: 'backend', repo_path: '/r/b', engine_type: 'manual' });
});
afterEach(() => {
  db.close();
  fs.rmSync(ws, { recursive: true, force: true });
});

const create = () =>
  requirements.createRequirement({ title: 'Rides', goal: 'Track rides', acceptance_criteria: ['a'], affected_projects: ['backend'], priority: 'normal' });

describe('requirement run settings: storage', () => {
  it('starts with no CLI and no target branch', () => {
    expect(create()).toMatchObject({ agent_cli: null, target_branch: null });
  });

  it('defaults the task branch pattern to the requirement ID and pushing to on', () => {
    expect(new SettingsService(db).getBranchMergeSettings()).toMatchObject({ task_branch_pattern: '{req}', push_branches: true });
  });

  it('remembers the preferred CLI of a local run', () => {
    const run = new RunStore(db).create({ bridgeTaskId: 1, project: 'backend', title: 'T', bodyMd: 'B', preferredCli: 'agy-cli' });
    expect(run.preferred_cli).toBe('agy-cli');
  });
});
