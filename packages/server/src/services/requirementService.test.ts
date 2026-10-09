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
});
