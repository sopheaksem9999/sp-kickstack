import { describe, it, expect } from 'vitest';
import { acceptanceCriteria, buildQaPrompt, type QaPromptInput } from './qaPrompt.js';

const body = [
  '# Ride tracking', '', '## Goal', 'Track rides', '', '## Acceptance criteria',
  '- [ ] Rides are saved', '- [x] Rides are listed', '* Old rides archived', '3. Admins see all rides', '',
  '## Attachments', '- 📎 banner.jpg',
].join('\n');

const input = (patch: Partial<QaPromptInput> = {}): QaPromptInput => ({
  reqId: 'REQ-008', title: 'Ride tracking', bodyMd: body, project: 'backend', commit: 'a'.repeat(40), from: 'b'.repeat(40),
  changedFiles: ['src/rides.ts', 'test/rides.test.ts'], commands: { test: 'npm test', build: 'npm run build', lint: null }, maxFindings: 30,
  ...patch,
});

describe('acceptanceCriteria', () => {
  it('reads the list under the Acceptance criteria heading', () => {
    expect(acceptanceCriteria(body)).toEqual(['Rides are saved', 'Rides are listed', 'Old rides archived', 'Admins see all rides']);
  });

  it('is empty without that heading', () => {
    expect(acceptanceCriteria('## Goal\n- not a criterion')).toEqual([]);
  });
});

describe('buildQaPrompt', () => {
  it('numbers the criteria and names the checkout, the changes and the commands', () => {
    const prompt = buildQaPrompt(input());
    expect(prompt.split('\n')[0]).toBe('# AI QA of REQ-008 in backend');
    expect(prompt).toContain(`commit \`${'a'.repeat(12)}\``);
    expect(prompt).toContain('1. Rides are saved\n2. Rides are listed\n3. Old rides archived\n4. Admins see all rides');
    expect(prompt).toContain('<untrusted_input name="requirement">');
    expect(prompt).toContain('- src/rides.ts\n- test/rides.test.ts');
    expect(prompt).toContain(`git log --oneline ${'b'.repeat(12)}..${'a'.repeat(12)}`);
    expect(prompt).toContain(`git diff ${'b'.repeat(12)}..${'a'.repeat(12)}`);
    expect(prompt).toContain('- Test command: `npm test`\n- Build command: `npm run build`');
    expect(prompt).not.toContain('Lint command');
  });

  it('states the rules and how to report', () => {
    const prompt = buildQaPrompt(input({ maxFindings: 12 }));
    expect(prompt).toContain('Do not commit, push, switch branches or edit files to fix anything.');
    expect(prompt).toContain('at most 12 findings');
    expect(prompt).toContain('xticket comment --severity blocker|major|minor');
    expect(prompt).toContain('xticket qa-result --passed --summary');
    expect(prompt).toContain('xticket qa-result --failed --summary');
    expect(prompt).toContain('Read CLAUDE.md and AGENTS.md');
    expect(prompt).toContain('Report only real problems in this repository: never post a test finding (for example to check that xticket works)');
    expect(prompt).toContain('do not report that something belongs to another repository');
  });

  it('says what to do without criteria, changed files, a range or commands', () => {
    const prompt = buildQaPrompt(input({ bodyMd: '## Goal\nTrack rides', changedFiles: [], from: null, commands: {} }));
    expect(prompt).toContain('The requirement has no acceptance criteria section');
    expect(prompt).toContain('No changed files were found for this requirement');
    expect(prompt).toContain('Inspect recent history with `git log` and `git show`.');
    expect(prompt).toContain('No test, build or lint command is set for this repository');
  });

  it('names the merge preview for review rounds', () => {
    const prompt = buildQaPrompt(input({ stage: 'review', previewInto: 'develop' }));
    expect(prompt).toContain("a temporary merge of the requirement's branches into `develop`, not merged yet");
    expect(prompt).not.toContain('the code after the requirement was merged');
  });

  it('lists at most 200 changed files and says how many more', () => {
    const files = Array.from({ length: 230 }, (_, i) => `src/file-${String(i).padStart(3, '0')}.ts`);
    const prompt = buildQaPrompt(input({ changedFiles: files }));
    expect(prompt).toContain('- src/file-199.ts');
    expect(prompt).not.toContain('- src/file-200.ts');
    expect(prompt).toContain('…and 30 more (see git diff)');
  });
});
