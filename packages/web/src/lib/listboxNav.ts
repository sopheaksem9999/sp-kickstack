/** Keyboard rules for a listbox of options: which option a key moves to, and type-ahead matching. */

/** Typing pauses longer than this start a new type-ahead word. */
export const TYPEAHEAD_RESET_MS = 700;

export interface TypeaheadState {
  text: string;
  /** When the last letter was typed (ms). */
  at: number;
}

/** The text typed so far with `key` added; it starts again when the last letter was typed a while ago. */
export function extendTypeahead(prev: TypeaheadState, key: string, now: number): TypeaheadState {
  const text = now - prev.at > TYPEAHEAD_RESET_MS ? key : prev.text + key;
  return { text, at: now };
}

/** True while letters were typed a moment ago; a Space then belongs to the word, otherwise it chooses. */
export function isTypingAhead(state: TypeaheadState, now: number): boolean {
  return state.text !== '' && now - state.at <= TYPEAHEAD_RESET_MS;
}

/**
 * The option a typed `query` moves to, or -1. One letter (or the same letter again) goes to the next
 * option starting with it, wrapping at the end; a longer word is matched from the active option on.
 */
export function typeaheadMatch(labels: readonly string[], activeIndex: number, query: string): number {
  const text = query.toLowerCase();
  const count = labels.length;
  if (!text || count === 0) return -1;
  const repeated = [...text].every((char) => char === text[0]);
  const needle = repeated ? text[0] : text;
  const start = repeated ? activeIndex + 1 : Math.max(activeIndex, 0);
  for (let offset = 0; offset < count; offset += 1) {
    const index = (start + offset) % count;
    if (labels[index].toLowerCase().startsWith(needle)) return index;
  }
  return -1;
}

/** The option an arrow, Home or End key moves to (no wrapping), or null for any other key. */
export function listboxTarget(key: string, activeIndex: number, count: number): number | null {
  if (count === 0) return null;
  if (key === 'ArrowDown') return Math.min(activeIndex + 1, count - 1);
  if (key === 'ArrowUp') return Math.max(activeIndex - 1, 0);
  if (key === 'Home') return 0;
  if (key === 'End') return count - 1;
  return null;
}
