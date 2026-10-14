import { describe, it, expect } from 'vitest';
import { VALID_SCRUM_TABS, ScrumTab } from '../pages/RequirementsPage';
import { VALID_VIEW_TABS, RequirementViewTab } from '../pages/RequirementDetailPage';
import { VALID_TABS as VALID_SETTINGS_TABS, SettingsTab } from '../pages/SettingsPage';
import { VALID_ATTACHMENTS_TABS, AttachmentsTab } from '../pages/AttachmentsPage';
import { VALID_QUEUE_TABS, QueueTab } from '../pages/QueuePage';
import { VALID_PROJECT_TABS, ProjectSplitTab } from '../pages/ProjectsPage';

describe('Web UI Tab URL Synchronization Governance', () => {
  describe('RequirementsPage Scrum tabs', () => {
    it('accepts valid scrum tab IDs', () => {
      expect(VALID_SCRUM_TABS).toEqual(['sprint', 'backlog', 'all']);
      for (const tab of ['sprint', 'backlog', 'all'] as ScrumTab[]) {
        expect(VALID_SCRUM_TABS.includes(tab)).toBe(true);
      }
    });

    it('falls back to "sprint" for missing or unknown tab parameters', () => {
      const resolveTab = (param: string | null): ScrumTab =>
        param && VALID_SCRUM_TABS.includes(param as ScrumTab) ? (param as ScrumTab) : 'sprint';

      expect(resolveTab(null)).toBe('sprint');
      expect(resolveTab('')).toBe('sprint');
      expect(resolveTab('invalid')).toBe('sprint');
      expect(resolveTab('backlog')).toBe('backlog');
      expect(resolveTab('all')).toBe('all');
    });
  });

  describe('RequirementDetailPage Execution View tabs', () => {
    it('accepts valid execution view tab IDs', () => {
      expect(VALID_VIEW_TABS).toEqual(['board', 'dag']);
      for (const tab of ['board', 'dag'] as RequirementViewTab[]) {
        expect(VALID_VIEW_TABS.includes(tab)).toBe(true);
      }
    });

    it('falls back to "board" for missing or unknown tab parameters', () => {
      const resolveTab = (param: string | null): RequirementViewTab =>
        param && VALID_VIEW_TABS.includes(param as RequirementViewTab) ? (param as RequirementViewTab) : 'board';

      expect(resolveTab(null)).toBe('board');
      expect(resolveTab('unknown')).toBe('board');
      expect(resolveTab('dag')).toBe('dag');
      expect(resolveTab('board')).toBe('board');
    });
  });

  describe('SettingsPage tabs', () => {
    it('accepts all 8 settings tab IDs', () => {
      expect(VALID_SETTINGS_TABS).toEqual(['ai', 'ai-chat', 'workspaces', 'git', 'ide', 'appearance', 'safety', 'notifications']);
    });

    it('falls back to "ai" for missing or invalid tab parameters', () => {
      const resolveTab = (param: string | null): SettingsTab =>
        param && VALID_SETTINGS_TABS.includes(param as SettingsTab) ? (param as SettingsTab) : 'ai';

      expect(resolveTab(null)).toBe('ai');
      expect(resolveTab('nonexistent')).toBe('ai');
      expect(resolveTab('workspaces')).toBe('workspaces');
      expect(resolveTab('git')).toBe('git');
      expect(resolveTab('ide')).toBe('ide');
      expect(resolveTab('safety')).toBe('safety');
      expect(resolveTab('notifications')).toBe('notifications');
    });
  });

  describe('AttachmentsPage tabs', () => {
    it('accepts ticket and shared tabs', () => {
      expect(VALID_ATTACHMENTS_TABS).toEqual(['ticket', 'shared']);
    });

    it('falls back to "ticket" for missing or invalid tab parameters', () => {
      const resolveTab = (param: string | null): AttachmentsTab =>
        param && VALID_ATTACHMENTS_TABS.includes(param as AttachmentsTab) ? (param as AttachmentsTab) : 'ticket';

      expect(resolveTab(null)).toBe('ticket');
      expect(resolveTab('invalid')).toBe('ticket');
      expect(resolveTab('shared')).toBe('shared');
    });
  });

  describe('QueuePage tabs', () => {
    it('accepts all 5 queue tab IDs', () => {
      expect(VALID_QUEUE_TABS).toEqual(['all', 'queued', 'running', 'failed', 'done']);
    });

    it('falls back to "all" for missing or invalid tab parameters', () => {
      const resolveTab = (param: string | null): QueueTab =>
        param && VALID_QUEUE_TABS.includes(param as QueueTab) ? (param as QueueTab) : 'all';

      expect(resolveTab(null)).toBe('all');
      expect(resolveTab('')).toBe('all');
      expect(resolveTab('invalid')).toBe('all');
      expect(resolveTab('queued')).toBe('queued');
      expect(resolveTab('running')).toBe('running');
      expect(resolveTab('failed')).toBe('failed');
      expect(resolveTab('done')).toBe('done');
    });
  });

  describe('ProjectsPage container tabs', () => {
    it('accepts review, terminal, and editor tabs', () => {
      expect(VALID_PROJECT_TABS).toEqual(['review', 'terminal', 'editor']);
      for (const tab of ['review', 'terminal', 'editor'] as ProjectSplitTab[]) {
        expect(VALID_PROJECT_TABS.includes(tab)).toBe(true);
      }
    });

    it('falls back to "review" for missing or invalid tab parameters', () => {
      const resolveTab = (param: string | null): ProjectSplitTab =>
        param && VALID_PROJECT_TABS.includes(param as ProjectSplitTab) ? (param as ProjectSplitTab) : 'review';

      expect(resolveTab(null)).toBe('review');
      expect(resolveTab('')).toBe('review');
      expect(resolveTab('invalid')).toBe('review');
      expect(resolveTab('review')).toBe('review');
      expect(resolveTab('terminal')).toBe('terminal');
      expect(resolveTab('editor')).toBe('editor');
    });
  });

  describe('Search parameter preservation during tab switches', () => {
    it('preserves existing query parameters when updating tab', () => {
      const search = new URLSearchParams('search=auth&filter=urgent');
      search.set('tab', 'backlog');

      expect(search.get('tab')).toBe('backlog');
      expect(search.get('search')).toBe('auth');
      expect(search.get('filter')).toBe('urgent');
      expect(search.toString()).toBe('search=auth&filter=urgent&tab=backlog');
    });

    it('supports ?tab= and ?session= interchangeably for AI Chat deep linking', () => {
      const resolveChatSession = (params: URLSearchParams): string | null =>
        params.get('tab') || params.get('session');

      expect(resolveChatSession(new URLSearchParams('tab=chat-session-123'))).toBe('chat-session-123');
      expect(resolveChatSession(new URLSearchParams('session=chat-session-456'))).toBe('chat-session-456');
      expect(resolveChatSession(new URLSearchParams('tab=chat-1&session=chat-1'))).toBe('chat-1');
      expect(resolveChatSession(new URLSearchParams(''))).toBeNull();
    });
  });
});
