export interface ParsedRequirementMarkdown {
  goal: string;
  userStory?: string;
  acceptanceCriteria: string[];
  apiHints?: string;
  notes?: string;
}

export function parseRequirementMarkdown(bodyMd: string): ParsedRequirementMarkdown {
  if (!bodyMd || typeof bodyMd !== 'string') {
    return { goal: '', acceptanceCriteria: [] };
  }

  // 1. Strip YAML frontmatter if present
  const content = bodyMd.replace(/^---\s*[\s\S]*?---\s*/, '').trim();

  // 2. Parse sections line by line
  const lines = content.split('\n');
  const sections: Record<string, string[]> = {};
  let currentHeader: string | null = null;
  const initialLines: string[] = [];

  for (const line of lines) {
    const headerMatch = line.match(/^##\s+([^\n]+)/);
    if (headerMatch) {
      currentHeader = headerMatch[1].trim().toLowerCase();
      if (!sections[currentHeader]) {
        sections[currentHeader] = [];
      }
    } else if (currentHeader) {
      sections[currentHeader].push(line);
    } else {
      initialLines.push(line);
    }
  }

  // 3. Fallback if no sections were matched
  if (Object.keys(sections).length === 0) {
    return {
      goal: content,
      acceptanceCriteria: [],
    };
  }

  // 4. Extract Goal
  const goal = (sections['goal'] ? sections['goal'].join('\n').trim() : '') || initialLines.join('\n').trim();

  // 5. Extract User Story
  const userStory = sections['user story'] ? sections['user story'].join('\n').trim() : undefined;

  // 6. Extract Acceptance Criteria checklist
  const criteriaLines = sections['acceptance criteria'] || [];
  const acceptanceCriteria: string[] = [];
  for (const line of criteriaLines) {
    const trimmed = line.trim();
    const itemMatch = trimmed.match(/^[-*]\s*(?:\[[ xX]\]\s*)?(.*)$/);
    if (itemMatch && itemMatch[1].trim()) {
      acceptanceCriteria.push(itemMatch[1].trim());
    }
  }

  // 7. Extract API hints & Notes
  const apiHints = sections['api hints'] ? sections['api hints'].join('\n').trim() : undefined;
  const rawNotes =
    sections['specification & architectural details'] ||
    sections['notes'] ||
    sections['specification'];
  const notes = rawNotes ? rawNotes.join('\n').trim() : undefined;

  return {
    goal,
    userStory,
    acceptanceCriteria,
    apiHints,
    notes,
  };
}
