import { describe, it, expect } from 'vitest';
import { applyFormat } from './markdownFormat';

describe('comment toolbar formatting', () => {
  it('wraps the selection, or a placeholder it selects', () => {
    expect(applyFormat('fix it now', 4, 6, 'bold')).toEqual({ text: 'fix **it** now', start: 6, end: 8 });
    expect(applyFormat('fix ', 4, 4, 'bold')).toEqual({ text: 'fix **bold text**', start: 6, end: 15 });
    expect(applyFormat('a b', 2, 3, 'italic')).toEqual({ text: 'a *b*', start: 3, end: 4 });
    expect(applyFormat('run npm test', 4, 12, 'code')).toEqual({ text: 'run `npm test`', start: 5, end: 13 });
  });

  it('puts a code block on its own lines', () => {
    expect(applyFormat('Error:\nboom', 7, 11, 'codeblock')).toEqual({ text: 'Error:\n```\nboom\n```', start: 11, end: 15 });
    expect(applyFormat('see this', 4, 8, 'codeblock')).toEqual({ text: 'see \n```\nthis\n```', start: 9, end: 13 });
  });

  it('turns the selected lines into a list', () => {
    expect(applyFormat('a\nb', 0, 3, 'bullet')).toEqual({ text: '- a\n- b', start: 0, end: 7 });
    expect(applyFormat('x\na\nb', 3, 4, 'numbered')).toEqual({ text: 'x\n1. a\n2. b', start: 2, end: 11 });
  });

  it('makes a link and selects its address', () => {
    expect(applyFormat('see docs', 4, 8, 'link')).toEqual({ text: 'see [docs](https://)', start: 11, end: 19 });
  });
});
