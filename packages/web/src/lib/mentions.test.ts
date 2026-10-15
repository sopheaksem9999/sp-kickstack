import { describe, it, expect } from 'vitest';
import { findTrigger, insertMention, mentionItems } from './mentions';

describe('# and @ in a comment box', () => {
  it('opens on # or @ at the start of a word, with what follows as the search', () => {
    expect(findTrigger('fix #src/ap', 11)).toEqual({ trigger: '#', start: 4, query: 'src/ap' });
    expect(findTrigger('@open', 5)).toEqual({ trigger: '@', start: 0, query: 'open' });
    expect(findTrigger('line\n#', 6)).toEqual({ trigger: '#', start: 5, query: '' });
    expect(findTrigger('mail a@b', 8)).toBeNull();
    expect(findTrigger('#done now', 9)).toBeNull();
    expect(findTrigger('plain text', 10)).toBeNull();
  });

  it('replaces the trigger and its search with the picked value, followed by one space', () => {
    expect(insertMention('fix #src/ap please', { trigger: '#', start: 4, query: 'src/ap' }, 'src/api/users.ts')).toEqual({
      text: 'fix #src/api/users.ts please',
      cursor: 22,
    });
    expect(insertMention('@op', { trigger: '@', start: 0, query: 'op' }, 'openapi.yaml')).toEqual({ text: '@openapi.yaml ', cursor: 14 });
  });

  it('lists files changed on the branch, then repositories, then requirements for #, and shared assets for @', () => {
    const sources = {
      files: ['src/api/users.ts', 'README.md'],
      projects: [{ name: 'frontend', kind: 'web' }, { name: 'backend', kind: 'backend' }],
      requirements: [
        { id: 'REQ-007', title: 'User search' },
        { id: 'REQ-008', title: 'Cancelled ticket', status: 'cancelled' },
      ],
      assets: [{ name: 'openapi.yaml', notes: 'API contract' }],
    };
    expect(mentionItems('#', '', sources).map((i) => [i.group, i.value])).toEqual([
      ['Files on the branch', 'src/api/users.ts'],
      ['Files on the branch', 'README.md'],
      ['Repositories', 'frontend'],
      ['Repositories', 'backend'],
      ['Requirements', 'REQ-007'],
    ]);
    expect(mentionItems('#', 'user', sources).map((i) => i.value)).toEqual(['src/api/users.ts', 'REQ-007']);
    expect(mentionItems('#', 'cancelled', sources).map((i) => i.value)).toEqual([]);
    expect(mentionItems('@', 'open', sources)).toEqual([{ key: '@openapi.yaml', group: 'Shared assets', value: 'openapi.yaml', detail: 'API contract' }]);
  });
});
