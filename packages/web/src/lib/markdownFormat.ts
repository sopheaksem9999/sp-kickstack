// Toolbar formatting for Markdown text boxes: wraps the selection (or a placeholder) and says what to select next.

export type FormatKind = 'bold' | 'italic' | 'code' | 'codeblock' | 'bullet' | 'numbered' | 'link';

export interface Formatted {
  text: string;
  /** Selection to show after formatting. */
  start: number;
  end: number;
}

const WRAP: Partial<Record<FormatKind, [open: string, close: string, placeholder: string]>> = {
  bold: ['**', '**', 'bold text'],
  italic: ['*', '*', 'italic text'],
  code: ['`', '`', 'code'],
};

export function applyFormat(text: string, start: number, end: number, kind: FormatKind): Formatted {
  const selected = text.slice(start, end);
  const before = text.slice(0, start);
  const after = text.slice(end);

  const wrap = WRAP[kind];
  if (wrap) {
    const [open, close, placeholder] = wrap;
    const inner = selected || placeholder;
    return { text: `${before}${open}${inner}${close}${after}`, start: start + open.length, end: start + open.length + inner.length };
  }
  if (kind === 'link') {
    const head = `${before}[${selected || 'link text'}](`;
    const url = 'https://';
    return { text: `${head}${url})${after}`, start: head.length, end: head.length + url.length };
  }
  if (kind === 'codeblock') {
    const lead = before && !before.endsWith('\n') ? '\n' : '';
    const trail = after && !after.startsWith('\n') ? '\n' : '';
    const inner = selected || 'code';
    const head = `${before}${lead}\`\`\`\n`;
    return { text: `${head}${inner}\n\`\`\`${trail}${after}`, start: head.length, end: head.length + inner.length };
  }

  // Lists: every line the selection touches.
  const lineStart = start === 0 ? 0 : text.lastIndexOf('\n', start - 1) + 1;
  const newline = text.indexOf('\n', end);
  const lineEnd = newline === -1 ? text.length : newline;
  const listed = text
    .slice(lineStart, lineEnd)
    .split('\n')
    .map((line, i) => `${kind === 'bullet' ? '- ' : `${i + 1}. `}${line}`)
    .join('\n');
  return { text: `${text.slice(0, lineStart)}${listed}${text.slice(lineEnd)}`, start: lineStart, end: lineStart + listed.length };
}
