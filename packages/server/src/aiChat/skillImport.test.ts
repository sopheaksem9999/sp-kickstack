import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { findSkillFiles, parseSkillFile, skillSlug } from './skillImport.js';

describe('SKILL.md files', () => {
  it('reads name and description from front matter, else the folder name', () => {
    expect(parseSkillFile('---\nname: api-contract\ndescription: "When writing an API"\n---\n# API\nUse OpenAPI.\n', 'x', '/s/SKILL.md')).toEqual({
      name: 'api-contract', description: 'When writing an API', body: '# API\nUse OpenAPI.', sourcePath: '/s/SKILL.md',
    });
    expect(parseSkillFile('Check criteria.\n', 'Spec Review', '/t/SKILL.md')).toEqual({ name: 'spec-review', description: '', body: 'Check criteria.', sourcePath: '/t/SKILL.md' });
    expect(skillSlug('  My_Skill!! ')).toBe('my-skill');
  });

  it('reads folded and literal YAML descriptions and caps them at 1024 characters', () => {
    expect(parseSkillFile('---\nname: bug-report\ndescription: >-\n  Use when a bug\n  is reported.\nlicense: MIT\n---\nBody\n', 'x', '/s').description).toBe('Use when a bug is reported.');
    expect(parseSkillFile('---\ndescription: |\n  Line one\n  Line two\n---\nB', 'x', '/s').description).toBe('Line one\nLine two');
    expect(parseSkillFile(`---\ndescription: ${'d'.repeat(1500)}\n---\nB`, 'x', '/s').description).toHaveLength(1024);
  });

  it('follows symlinked skill folders without looping', () => {
    const real = fs.mkdtempSync(path.join(os.tmpdir(), 'sp-skills-real-'));
    fs.mkdirSync(path.join(real, 'docx'));
    fs.writeFileSync(path.join(real, 'docx', 'SKILL.md'), 'x');
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sp-skills-links-'));
    fs.symlinkSync(path.join(real, 'docx'), path.join(dir, 'docx'));
    fs.symlinkSync(dir, path.join(dir, 'loop'));
    expect(findSkillFiles(dir).map((f) => path.relative(dir, f))).toEqual(['docx/SKILL.md']);
  });

  it('finds SKILL.md files below a folder, skipping node_modules and .git', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sp-skills-'));
    for (const rel of ['b/SKILL.md', 'a/SKILL.md', 'a/deep/c/SKILL.md', 'node_modules/p/SKILL.md', '.git/x/SKILL.md', 'a/README.md']) {
      fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true });
      fs.writeFileSync(path.join(dir, rel), 'x');
    }
    expect(findSkillFiles(dir).map((f) => path.relative(dir, f))).toEqual(['a/deep/c/SKILL.md', 'a/SKILL.md', 'b/SKILL.md']);
  });
});
