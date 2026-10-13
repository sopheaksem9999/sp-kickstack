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
import { CreateRequirementInputSchema } from '@sp-kickstack/shared';

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

  it('keeps a target branch given at creation, and checks its name', () => {
    const req = requirements.createRequirement({
      title: 'Rides', goal: 'g', acceptance_criteria: ['a'], affected_projects: ['backend'], priority: 'normal', target_branch: 'release/1.3',
    });
    expect(req.target_branch).toBe('release/1.3');
    expect(() => CreateRequirementInputSchema.parse({ title: 'T', goal: 'g', affected_projects: ['backend'], target_branch: 'bad..name' })).toThrow();
  });

  it('remembers the preferred CLI of a local run', () => {
    const run = new RunStore(db).create({ bridgeTaskId: 1, project: 'backend', title: 'T', bodyMd: 'B', preferredCli: 'agy-cli' });
    expect(run.preferred_cli).toBe('agy-cli');
  });
});

describe('requirement run settings: saving', () => {
  const addTask = (reqId: string, branch: string) =>
    db.prepare("INSERT INTO bridge_tasks (req_id, project, role, title, status, branch, created_at, updated_at) VALUES (?, 'backend', 'goal', 'T', 'queued', ?, 'x', 'x')")
      .run(reqId, branch).lastInsertRowid;

  it('saves, keeps what is not sent and clears what is null', () => {
    const req = create();
    requirements.updateRunSettings(req.id, { agent_cli: 'agy-cli', agent_model: 'gemini-3.8-flash', agent_effort: 'high', target_branch: 'release/1.3', merge_policy: 'auto_merge' });
    expect(requirements.updateRunSettings(req.id, { agent_effort: null })).toMatchObject({
      agent_cli: 'agy-cli', agent_model: 'gemini-3.8-flash', agent_effort: null, target_branch: 'release/1.3', merge_policy: 'auto_merge',
    });
    expect(requirements.updateRunSettings(req.id, { target_branch: null }).target_branch).toBeNull();
  });

  it('refuses a bad branch name and a task branch as the target', () => {
    const req = create();
    expect(() => requirements.updateRunSettings(req.id, { target_branch: '../x' })).toThrow(/cannot contain/);
    const other = create();
    const taskId = addTask(other.id, 'REQ-OTHER');
    expect(() => requirements.updateRunSettings(req.id, { target_branch: 'REQ-OTHER' })).toThrow(`REQ-OTHER is the branch of task #${taskId}; choose another target branch`);
  });

  it('locks the target branch after fan-out but keeps the rest editable', () => {
    const req = create();
    requirements.updateRunSettings(req.id, { target_branch: 'release/1.3' });
    addTask(req.id, req.id);
    expect(() => requirements.updateRunSettings(req.id, { target_branch: 'release/2.0' })).toThrow(
      `${req.id} was already fanned out to release/1.3; the target branch cannot change (create a new requirement for another branch)`
    );
    expect(requirements.updateRunSettings(req.id, { target_branch: 'release/1.3', agent_cli: 'claude-cli' })).toMatchObject({ target_branch: 'release/1.3', agent_cli: 'claude-cli' });
  });

  it('refuses changes once the requirement is done or cancelled', () => {
    const req = create();
    requirements.updateStatus(req.id, 'cancelled');
    expect(() => requirements.updateRunSettings(req.id, { agent_cli: 'agy-cli' })).toThrow(`${req.id} is cancelled; its run settings can no longer change`);
  });
});
