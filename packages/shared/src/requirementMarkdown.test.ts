import { describe, it, expect } from 'vitest';
import { parseRequirementMarkdown } from './requirementMarkdown.js';

describe('parseRequirementMarkdown', () => {
  it('parses standard rendered markdown with all sections', () => {
    const md = `---
id: REQ-001
title: [Realtime] Live Map Tracking
priority: high
projects: [backend, frontend]
status: draft
revision: 1
---

## Goal
Enable real-time driver tracking on the user map.

## User story
As a rider, I want to see nearby drivers so I can book immediately.

## Acceptance criteria
- [ ] Connects to WebSocket gateway
- [ ] Updates driver coordinates at 5 Hz
- [x] Renders custom vehicle markers on map

## API hints
Use endpoint GET /api/v1/drivers/stream

## Specification & Architectural Details
Requires Redis pub/sub backplane for location fanout.
`;

    const parsed = parseRequirementMarkdown(md);
    expect(parsed.goal).toBe('Enable real-time driver tracking on the user map.');
    expect(parsed.userStory).toBe('As a rider, I want to see nearby drivers so I can book immediately.');
    expect(parsed.acceptanceCriteria).toEqual([
      'Connects to WebSocket gateway',
      'Updates driver coordinates at 5 Hz',
      'Renders custom vehicle markers on map',
    ]);
    expect(parsed.apiHints).toBe('Use endpoint GET /api/v1/drivers/stream');
    expect(parsed.notes).toBe('Requires Redis pub/sub backplane for location fanout.');
  });

  it('handles unstructured markdown without standard section headers', () => {
    const raw = `This is a simple requirement description without headers.
It has multiple lines.`;

    const parsed = parseRequirementMarkdown(raw);
    expect(parsed.goal).toBe('This is a simple requirement description without headers.\nIt has multiple lines.');
    expect(parsed.userStory).toBeUndefined();
    expect(parsed.acceptanceCriteria).toEqual([]);
  });
});
