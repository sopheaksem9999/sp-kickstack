import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { initDatabase, AppDatabase } from '../db/index.js';
import { SprintService } from './sprintService.js';
import { RequirementService } from './requirementService.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const testWorkspace = path.resolve(__dirname, '../../.temp/test-workspace-sprint');

describe('SprintService & Scrum Lifecycle', () => {
  let db: AppDatabase;
  let sprintService: SprintService;
  let requirementService: RequirementService;

  beforeEach(() => {
    fs.mkdirSync(testWorkspace, { recursive: true });
    db = initDatabase(':memory:');
    db.prepare(`
      INSERT OR IGNORE INTO workspaces (id, name, description, rules, context, created_at, updated_at)
      VALUES 
        ('ws_1', 'Workspace 1', '', '', '', datetime('now'), datetime('now')),
        ('ws_2', 'Workspace 2', '', '', '', datetime('now'), datetime('now'))
    `).run();
    db.prepare(`
      INSERT OR IGNORE INTO projects (name, workspace_id, repo_path, engine_type, created_at, updated_at)
      VALUES ('p1', 'ws_1', '/tmp/p1', 'fake', datetime('now'), datetime('now'))
    `).run();
    sprintService = new SprintService(db);
    requirementService = new RequirementService(db, testWorkspace);
  });

  afterAll(() => {
    fs.rmSync(testWorkspace, { recursive: true, force: true });
  });

  it('should create and list sprints', () => {
    const sprint = sprintService.createSprint({
      workspace_id: 'ws_1',
      name: 'Sprint 1',
      goal: 'Deliver MVP auth',
      start_date: '2026-10-01',
      end_date: '2026-10-14',
    });

    expect(sprint.id).toBeDefined();
    expect(sprint.name).toBe('Sprint 1');
    expect(sprint.status).toBe('planned');
    expect(sprint.workspace_id).toBe('ws_1');

    const list = sprintService.listSprints('ws_1');
    expect(list.length).toBe(1);
    expect(list[0].id).toBe(sprint.id);

    // List for another workspace
    const otherList = sprintService.listSprints('ws_2');
    expect(otherList.length).toBe(0);
  });

  it('should enforce single active sprint per workspace on start', () => {
    const s1 = sprintService.createSprint({ workspace_id: 'ws_1', name: 'Sprint 1' });
    const s2 = sprintService.createSprint({ workspace_id: 'ws_1', name: 'Sprint 2' });

    sprintService.startSprint(s1.id);
    expect(sprintService.getSprint(s1.id)?.status).toBe('active');
    expect(sprintService.getActiveSprint('ws_1')?.id).toBe(s1.id);

    // Starting s2 should complete s1
    sprintService.startSprint(s2.id);
    expect(sprintService.getSprint(s1.id)?.status).toBe('completed');
    expect(sprintService.getSprint(s2.id)?.status).toBe('active');
    expect(sprintService.getActiveSprint('ws_1')?.id).toBe(s2.id);
  });

  it('should assign requirements to sprint and rollover unfinished items upon completion', () => {
    const sprint = sprintService.createSprint({ workspace_id: 'ws_1', name: 'Sprint Alpha' });
    sprintService.startSprint(sprint.id);

    // Create 3 requirements: 2 in sprint, 1 in backlog
    const r1 = requirementService.createRequirement({
      workspace_id: 'ws_1',
      title: 'Task 1 - Done',
      goal: 'Done goal',
      affected_projects: ['p1'],
      sprint_id: sprint.id,
    });
    const r2 = requirementService.createRequirement({
      workspace_id: 'ws_1',
      title: 'Task 2 - Incomplete',
      goal: 'Incomplete goal',
      affected_projects: ['p1'],
      sprint_id: sprint.id,
    });
    const r3 = requirementService.createRequirement({
      workspace_id: 'ws_1',
      title: 'Task 3 - Backlog',
      goal: 'Backlog goal',
      affected_projects: ['p1'],
    });

    // Mark r1 as done
    requirementService.updateRequirementStatus(r1.id, 'done');

    expect(requirementService.getRequirement(r1.id)?.sprint_id).toBe(sprint.id);
    expect(requirementService.getRequirement(r2.id)?.sprint_id).toBe(sprint.id);
    expect(requirementService.getRequirement(r3.id)?.sprint_id).toBeNull();

    // Complete the sprint
    const result = sprintService.completeSprint(sprint.id);
    expect(result.sprint.status).toBe('completed');
    expect(result.rolledOverCount).toBe(1); // r2 rolled over

    // Check requirement statuses and sprint assignment
    const updatedR1 = requirementService.getRequirement(r1.id);
    const updatedR2 = requirementService.getRequirement(r2.id);
    const updatedR3 = requirementService.getRequirement(r3.id);

    expect(updatedR1?.sprint_id).toBe(sprint.id); // Done items stay in the sprint
    expect(updatedR2?.sprint_id).toBeNull(); // Unfinished rolled back to backlog (sprint_id is null)
    expect(updatedR3?.sprint_id).toBeNull(); // Backlog unchanged
  });

  it('should reassign requirement sprint via updateRequirementSprint', () => {
    const sprint = sprintService.createSprint({ workspace_id: 'ws_1', name: 'Sprint Beta' });
    const r = requirementService.createRequirement({
      workspace_id: 'ws_1',
      title: 'Backlog item',
      goal: 'Item goal',
      affected_projects: ['p1'],
    });

    expect(requirementService.getRequirement(r.id)?.sprint_id).toBeNull();

    const assigned = requirementService.updateRequirementSprint(r.id, sprint.id);
    expect(assigned.sprint_id).toBe(sprint.id);

    const unassigned = requirementService.updateRequirementSprint(r.id, null);
    expect(unassigned.sprint_id).toBeNull();
  });
});
