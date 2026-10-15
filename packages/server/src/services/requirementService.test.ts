import { describe, it, expect, beforeEach, afterEach, afterAll } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { initDatabase, AppDatabase } from '../db/index.js';
import { RequirementService } from './requirementService.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const tempWorkspace = path.resolve(__dirname, '../../.temp/sp-test-requirement-service');

describe('RequirementService.createRequirement durability', () => {
  let db: AppDatabase;
  let service: RequirementService;

  beforeEach(() => {
    fs.rmSync(tempWorkspace, { recursive: true, force: true });
    db = initDatabase(':memory:');
    service = new RequirementService(db, tempWorkspace);
    db.prepare(`
      INSERT INTO projects (name, repo_path, engine_type, created_at, updated_at)
      VALUES ('backend', '/r', 'manual', 'x', 'x')
    `).run();
  });

  afterEach(() => db.close());

  afterAll(() => fs.rmSync(tempWorkspace, { recursive: true, force: true }));

  it('writes the markdown file once the row is stored', () => {
    const req = service.createRequirement({
      title: 'Ok',
      goal: 'g',
      acceptance_criteria: ['a'],
      affected_projects: ['backend'],
      priority: 'normal',
    });
    expect(fs.readFileSync(req.file_path, 'utf-8')).toContain(`id: ${req.id}`);
  });

  it('leaves no markdown file behind when the insert fails', () => {
    expect(() =>
      service.createRequirement({
        title: 'Bad project',
        goal: 'g',
        acceptance_criteria: ['a'],
        affected_projects: ['not-registered'],
        priority: 'normal',
      })
    ).toThrow(/FOREIGN KEY/);

    const reqDir = path.join(tempWorkspace, 'requirements');
    const files = fs.existsSync(reqDir) ? fs.readdirSync(reqDir) : [];
    expect(files).toEqual([]);
    expect((db.prepare('SELECT COUNT(*) c FROM requirements').get() as any).c).toBe(0);
  });

  it('updates structured fields, target_branch, attachments, and re-renders body_md', () => {
    const created = service.createRequirement({
      title: 'Initial Title',
      goal: 'Initial Goal',
      affected_projects: ['backend'],
      priority: 'normal',
    });

    const updated = service.updateRequirement(created.id, {
      title: 'Updated Title',
      goal: 'New Goal Text',
      user_story: 'As a user I want parity',
      acceptance_criteria: ['Check 1', 'Check 2'],
      priority: 'urgent',
      target_branch: 'release/v1',
      attachments: [{ name: 'doc.txt', size: 100, type: 'text/plain', data_url: 'data:text/plain;base64,abc' }],
    });

    expect(updated.title).toBe('Updated Title');
    expect(updated.priority).toBe('urgent');
    expect(updated.target_branch).toBe('release/v1');
    expect(updated.attachments).toHaveLength(1);
    expect(updated.body_md).toContain('New Goal Text');
    expect(updated.body_md).toContain('As a user I want parity');
    expect(updated.body_md).toContain('- [ ] Check 1');
    expect(updated.body_md).toContain('- [ ] Check 2');

    // Check disk files
    expect(fs.readFileSync(updated.file_path, 'utf-8')).toContain('New Goal Text');
  });
});

