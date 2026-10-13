import { describe, it, expect } from 'vitest';
import { extendTypeahead, isTypingAhead, listboxTarget, typeaheadMatch, TYPEAHEAD_RESET_MS } from './listboxNav';

const LABELS = ['All repositories', 'backend', 'billing', 'mobile', 'ops'];

describe('typeaheadMatch', () => {
  it('moves to the next option that starts with the typed letter', () => {
    expect(typeaheadMatch(LABELS, 0, 'b')).toBe(1);
    expect(typeaheadMatch(LABELS, 1, 'b')).toBe(2);
    expect(typeaheadMatch(LABELS, 2, 'b')).toBe(1);
    expect(typeaheadMatch(LABELS, 0, 'm')).toBe(3);
  });

  it('ignores case', () => {
    expect(typeaheadMatch(LABELS, 0, 'O')).toBe(4);
    expect(typeaheadMatch(LABELS, 3, 'a')).toBe(0);
  });

  it('matches a longer prefix, starting at the active option', () => {
    expect(typeaheadMatch(LABELS, 0, 'bi')).toBe(2);
    expect(typeaheadMatch(LABELS, 2, 'bi')).toBe(2);
    expect(typeaheadMatch(LABELS, 0, 'ba')).toBe(1);
  });

  it('wraps around the end of the list', () => {
    expect(typeaheadMatch(LABELS, 4, 'a')).toBe(0);
    expect(typeaheadMatch(LABELS, 4, 'o')).toBe(4);
  });

  it('cycles when the same letter is typed again', () => {
    expect(typeaheadMatch(LABELS, 1, 'bb')).toBe(2);
    expect(typeaheadMatch(LABELS, 2, 'bb')).toBe(1);
  });

  it('answers -1 when nothing starts with the text, or the text is empty', () => {
    expect(typeaheadMatch(LABELS, 0, 'z')).toBe(-1);
    expect(typeaheadMatch(LABELS, 0, 'bz')).toBe(-1);
    expect(typeaheadMatch(LABELS, 0, '')).toBe(-1);
    expect(typeaheadMatch([], 0, 'a')).toBe(-1);
  });

  it('copes with no active option yet', () => {
    expect(typeaheadMatch(LABELS, -1, 'b')).toBe(1);
  });
});

describe('extendTypeahead', () => {
  it('adds the key to the text typed a moment ago', () => {
    const first = extendTypeahead({ text: '', at: 0 }, 'b', 1000);
    expect(first).toEqual({ text: 'b', at: 1000 });
    expect(extendTypeahead(first, 'i', 1000 + TYPEAHEAD_RESET_MS - 1)).toEqual({ text: 'bi', at: 1000 + TYPEAHEAD_RESET_MS - 1 });
  });

  it('starts again once the pause is long enough', () => {
    const first = extendTypeahead({ text: '', at: 0 }, 'b', 1000);
    expect(extendTypeahead(first, 'm', 1000 + TYPEAHEAD_RESET_MS + 1)).toEqual({ text: 'm', at: 1000 + TYPEAHEAD_RESET_MS + 1 });
  });
});

describe('isTypingAhead', () => {
  it('is true only while letters were typed a moment ago, so a Space after a pause still chooses', () => {
    expect(isTypingAhead({ text: '', at: 0 }, 100)).toBe(false);
    expect(isTypingAhead({ text: 'ba', at: 1000 }, 1000 + TYPEAHEAD_RESET_MS)).toBe(true);
    expect(isTypingAhead({ text: 'ba', at: 1000 }, 1000 + TYPEAHEAD_RESET_MS + 1)).toBe(false);
  });
});

describe('listboxTarget', () => {
  it('moves one option for the arrow keys and stops at the ends', () => {
    expect(listboxTarget('ArrowDown', 1, 4)).toBe(2);
    expect(listboxTarget('ArrowDown', 3, 4)).toBe(3);
    expect(listboxTarget('ArrowUp', 2, 4)).toBe(1);
    expect(listboxTarget('ArrowUp', 0, 4)).toBe(0);
  });

  it('jumps to the first and last option with Home and End', () => {
    expect(listboxTarget('Home', 2, 4)).toBe(0);
    expect(listboxTarget('End', 1, 4)).toBe(3);
  });

  it('answers null for other keys and for an empty list', () => {
    expect(listboxTarget('Enter', 1, 4)).toBeNull();
    expect(listboxTarget('a', 1, 4)).toBeNull();
    expect(listboxTarget('ArrowDown', 0, 0)).toBeNull();
  });
});
