// "#" and "@" in a comment box, as in AI chat: # points at files on the task branch, repositories and
// requirements; @ at shared workspace assets.

export type MentionTrigger = '#' | '@';

export interface MentionMatch {
  trigger: MentionTrigger;
  /** Index of the trigger character. */
  start: number;
  /** What was typed after it. */
  query: string;
}

export interface MentionItem {
  key: string;
  group: string;
  /** Inserted after the trigger. */
  value: string;
  detail?: string;
}

export interface MentionSources {
  files?: string[];
  projects?: Array<{ name: string; kind?: string }>;
  requirements?: Array<{ id: string; title: string; status?: string }>;
  assets?: Array<{ name: string; notes?: string }>;
}

const PER_GROUP = 8;

/** The # or @ being typed at `cursor`: at the start of a word, with no space after it yet. */
export function findTrigger(text: string, cursor: number): MentionMatch | null {
  const before = text.slice(0, cursor);
  const match = /(^|\s)([#@])(\S*)$/.exec(before);
  if (!match) return null;
  return { trigger: match[2] as MentionTrigger, start: before.length - match[3].length - 1, query: match[3] };
}

/** Replace the trigger and its search with the picked value and one space; where the cursor goes. */
export function insertMention(text: string, at: MentionMatch, value: string): { text: string; cursor: number } {
  const before = text.slice(0, at.start);
  const after = text.slice(at.start + 1 + at.query.length);
  const inserted = `${at.trigger}${value} `;
  return { text: `${before}${inserted}${after.replace(/^ /, '')}`, cursor: before.length + inserted.length };
}

/** Menu items for the trigger, filtered by the search: # files, repositories, requirements; @ shared assets. */
export function mentionItems(trigger: MentionTrigger, query: string, sources: MentionSources): MentionItem[] {
  const q = query.toLowerCase();
  const hit = (...texts: Array<string | undefined>) => !q || texts.some((t) => t?.toLowerCase().includes(q));
  if (trigger === '@') {
    return (sources.assets ?? [])
      .filter((a) => hit(a.name, a.notes))
      .slice(0, PER_GROUP)
      .map((a) => ({ key: `@${a.name}`, group: 'Shared assets', value: a.name, ...(a.notes ? { detail: a.notes } : {}) }));
  }
  return [
    ...(sources.files ?? [])
      .filter((f) => hit(f))
      .slice(0, PER_GROUP)
      .map((f) => ({ key: `file:${f}`, group: 'Files on the branch', value: f })),
    ...(sources.projects ?? [])
      .filter((p) => hit(p.name, p.kind))
      .slice(0, PER_GROUP)
      .map((p) => ({ key: `repo:${p.name}`, group: 'Repositories', value: p.name, ...(p.kind ? { detail: p.kind } : {}) })),
    ...(sources.requirements ?? [])
      .filter((r) => r.status !== 'cancelled' && hit(r.id, r.title))
      .slice(0, PER_GROUP)
      .map((r) => ({ key: `req:${r.id}`, group: 'Requirements', value: r.id, detail: r.title })),
  ];
}
