import { describe, it, expect } from 'vitest';
import { resolveTabInfo } from './TabContext.js';

describe('resolveTabInfo', () => {
  it('resolves requirements routes correctly', () => {
    expect(resolveTabInfo('/w/sp-kickstack/requirements')).toEqual({
      title: 'Requirements',
      icon: 'layers',
    });
    expect(resolveTabInfo('/w/sp-kickstack/requirements?tab=backlog')).toEqual({
      title: 'Backlog',
      icon: 'layers',
    });
    expect(resolveTabInfo('/w/sp-kickstack/requirements?tab=all')).toEqual({
      title: 'All Requirements',
      icon: 'layers',
    });
    expect(resolveTabInfo('/w/sp-kickstack/requirements/new')).toEqual({
      title: 'New Requirement',
      icon: 'layers',
    });
    expect(resolveTabInfo('/w/sp-kickstack/requirements/REQ-001')).toEqual({
      title: 'REQ-001',
      icon: 'layers',
    });
  });

  it('resolves queue, chat, attachments, and metrics routes', () => {
    expect(resolveTabInfo('/w/sp-kickstack/queue')).toEqual({
      title: 'Agent Queue',
      icon: 'queue',
    });
    expect(resolveTabInfo('/w/sp-kickstack/chat')).toEqual({
      title: 'AI Architect Chat',
      icon: 'chat',
    });
    expect(resolveTabInfo('/w/sp-kickstack/attachments')).toEqual({
      title: 'Attachments',
      icon: 'paperclip',
    });
    expect(resolveTabInfo('/w/sp-kickstack/metrics')).toEqual({
      title: 'Telemetry & Sprints',
      icon: 'chart',
    });
  });

  it('resolves project tabs and sub-views', () => {
    expect(resolveTabInfo('/w/sp-kickstack/projects')).toEqual({
      title: 'Repositories',
      icon: 'folder',
    });
    expect(
      resolveTabInfo('/w/sp-kickstack/projects?project=frontend&tab=editor')
    ).toEqual({
      title: 'Editor: frontend',
      icon: 'code',
    });
    expect(
      resolveTabInfo('/w/sp-kickstack/projects?project=backend&tab=terminal')
    ).toEqual({
      title: 'Terminal: backend',
      icon: 'terminal',
    });
    expect(resolveTabInfo('/w/sp-kickstack/projects?project=infra')).toEqual({
      title: 'Repo: infra',
      icon: 'folder',
    });
  });

  it('resolves settings tabs and defaults', () => {
    expect(resolveTabInfo('/w/sp-kickstack/settings')).toEqual({
      title: 'Settings',
      icon: 'settings',
    });
    expect(resolveTabInfo('/w/sp-kickstack/settings?tab=appearance')).toEqual({
      title: 'Settings: APPEARANCE',
      icon: 'settings',
    });
    expect(resolveTabInfo('/w/sp-kickstack/settings?tab=ai')).toEqual({
      title: 'Settings: AI',
      icon: 'settings',
    });
  });

  it('falls back gracefully on arbitrary paths', () => {
    expect(resolveTabInfo('/unknown/custom-page')).toEqual({
      title: 'Workspace',
      icon: 'layers',
    });
  });
});
