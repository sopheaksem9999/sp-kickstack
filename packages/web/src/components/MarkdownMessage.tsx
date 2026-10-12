import React, { useState } from 'react';
import { Copy, Check, ExternalLink } from 'lucide-react';
import { toast } from 'sonner';

interface CodeBlockProps {
  language: string;
  code: string;
}

export function CodeBlock({ language, code }: CodeBlockProps) {
  const [copied, setCopied] = useState(false);

  const handleCopy = () => {
    navigator.clipboard.writeText(code);
    setCopied(true);
    toast.success('Code copied to clipboard');
    setTimeout(() => setCopied(false), 2000);
  };

  const displayLang = language.trim().toLowerCase() || 'code';

  return (
    <div className="my-3 rounded-xl overflow-hidden border border-slate-800/80 dark:border-[#2d2f3d] bg-[#0d0e15] shadow-md text-left">
      {/* ChatGPT-style Code Header Bar */}
      <div className="flex items-center justify-between px-3.5 py-1.5 bg-[#171824] border-b border-slate-800/80 text-[11px] text-slate-300 font-mono">
        <span className="font-semibold text-slate-400 lowercase">{displayLang}</span>
        <button
          type="button"
          onClick={handleCopy}
          className="flex items-center gap-1.5 py-0.5 px-2 rounded-md hover:bg-slate-700/50 text-slate-300 hover:text-white transition-colors"
          title="Copy code"
        >
          {copied ? (
            <>
              <Check className="w-3.5 h-3.5 text-emerald-400" />
              <span className="text-[10px] text-emerald-400 font-sans font-medium">Copied!</span>
            </>
          ) : (
            <>
              <Copy className="w-3.5 h-3.5 text-slate-400" />
              <span className="text-[10px] font-sans">Copy code</span>
            </>
          )}
        </button>
      </div>

      {/* Code Body */}
      <pre className="p-3.5 text-[11px] font-mono leading-relaxed text-slate-100 overflow-x-auto selection:bg-purple-900 selection:text-white whitespace-pre">
        <code>{code}</code>
      </pre>
    </div>
  );
}

export function renderInlineMarkdown(
  text: string,
  onSelectRequirement?: (reqId: string) => void
): React.ReactNode[] {
  // Regex matches:
  // 1. Markdown links: [title](url)
  // 2. Bold text: **bold**
  // 3. Inline code: `code`
  // 4. Italic text: *italic* or _italic_
  // 5. Ticket references: #REQ-xxx, REQ-xxx, #CG-xxx, #123
  const tokenRegex = /(\[.*?\]\(.*?\)|\*\*.*?\*\*|`.*?`|\*.*?\*|#?(?:REQ|req)-\d+|#(?:CG|cg)-[A-Za-z0-9_-]+|#[A-Za-z0-9_-]{2,})/g;
  const parts = text.split(tokenRegex);

  return parts.map((part, i) => {
    if (!part) return null;

    // Requirement Key Reference: #REQ-xxx or REQ-xxx (Clickable to open form)
    const reqMatch = part.match(/^#?(REQ-\d+)$/i);
    if (reqMatch) {
      const reqId = reqMatch[1].toUpperCase();
      return (
        <button
          key={i}
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onSelectRequirement?.(reqId);
          }}
          className="inline-flex items-center gap-1 px-1.5 py-0.5 mx-0.5 rounded-md bg-purple-100 hover:bg-purple-200 dark:bg-purple-950/80 dark:hover:bg-purple-900/80 border border-purple-300 dark:border-purple-800 text-purple-800 dark:text-purple-300 font-mono text-[11px] font-bold shadow-2xs cursor-pointer transition-all hover:scale-105 active:scale-95"
          title={`Click to open ${reqId} form`}
        >
          <span>#{reqId}</span>
        </button>
      );
    }

    // Other Ticket/Hashtag Reference: #CG-xxx or other hashtags
    if (part.startsWith('#') && part.length >= 2 && !part.includes(' ')) {
      return (
        <span
          key={i}
          className="inline-flex items-center gap-0.5 px-1.5 py-0.2 mx-0.5 rounded-md bg-purple-100 dark:bg-purple-950/70 border border-purple-200 dark:border-purple-800/50 text-purple-700 dark:text-purple-300 font-mono text-[11px] font-semibold shadow-2xs"
        >
          {part}
        </span>
      );
    }

    // Link: [title](url)
    const linkMatch = part.match(/^\[(.*?)\]\((.*?)\)$/);
    if (linkMatch) {
      const linkText = linkMatch[1];
      const linkUrl = linkMatch[2];
      const reqFromLink = linkUrl.match(/\/requirements\/(REQ-\d+)/i) || linkText.match(/#?(REQ-\d+)/i);
      if (reqFromLink && onSelectRequirement) {
        const reqId = reqFromLink[1].toUpperCase();
        return (
          <button
            key={i}
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onSelectRequirement(reqId);
            }}
            className="inline-flex items-center gap-1 px-1.5 py-0.5 mx-0.5 rounded-md bg-purple-100 hover:bg-purple-200 dark:bg-purple-950/80 dark:hover:bg-purple-900/80 border border-purple-300 dark:border-purple-800 text-purple-800 dark:text-purple-300 font-mono text-[11px] font-bold shadow-2xs cursor-pointer transition-all hover:scale-105 active:scale-95"
            title={`Click to open form for #${reqId}`}
          >
            <span>{linkText}</span>
          </button>
        );
      }
      return (
        <a
          key={i}
          href={linkUrl}
          target="_blank"
          rel="noreferrer"
          className="text-purple-600 dark:text-purple-400 underline underline-offset-2 hover:text-purple-500 dark:hover:text-purple-300 font-medium inline-flex items-center gap-0.5"
        >
          <span>{linkText}</span>
          <ExternalLink className="w-2.5 h-2.5 opacity-70" />
        </a>
      );
    }

    // Bold: **text**
    if (part.startsWith('**') && part.endsWith('**') && part.length >= 4) {
      const innerText = part.slice(2, -2);
      const innerReqMatch = innerText.match(/^#?(REQ-\d+)$/i);
      if (innerReqMatch && onSelectRequirement) {
        const reqId = innerReqMatch[1].toUpperCase();
        return (
          <button
            key={i}
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onSelectRequirement(reqId);
            }}
            className="inline-flex items-center gap-1 px-1.5 py-0.5 mx-0.5 rounded-md bg-purple-100 hover:bg-purple-200 dark:bg-purple-950/80 dark:hover:bg-purple-900/80 border border-purple-300 dark:border-purple-800 text-purple-800 dark:text-purple-300 font-mono text-[11px] font-bold shadow-2xs cursor-pointer transition-all hover:scale-105 active:scale-95"
            title={`Click to open form for #${reqId}`}
          >
            <span>#{reqId}</span>
          </button>
        );
      }
      return (
        <strong key={i} className="font-semibold text-slate-900 dark:text-white">
          {innerText}
        </strong>
      );
    }

    // Inline Code: `code`
    if (part.startsWith('`') && part.endsWith('`') && part.length >= 2) {
      const innerCode = part.slice(1, -1);
      const innerReqMatch = innerCode.match(/^#?(REQ-\d+)$/i);
      if (innerReqMatch && onSelectRequirement) {
        const reqId = innerReqMatch[1].toUpperCase();
        return (
          <button
            key={i}
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onSelectRequirement(reqId);
            }}
            className="inline-flex items-center gap-1 px-1.5 py-0.5 mx-0.5 rounded-md bg-purple-100 hover:bg-purple-200 dark:bg-purple-950/80 dark:hover:bg-purple-900/80 border border-purple-300 dark:border-purple-800 text-purple-800 dark:text-purple-300 font-mono text-[11px] font-bold shadow-2xs cursor-pointer transition-all hover:scale-105 active:scale-95"
            title={`Click to open form for #${reqId}`}
          >
            <span>#{reqId}</span>
          </button>
        );
      }
      return (
        <code
          key={i}
          className="px-1.5 py-0.5 rounded bg-slate-100 dark:bg-[#252736] border border-slate-200/60 dark:border-white/10 text-purple-600 dark:text-purple-300 font-mono text-[11px]"
        >
          {innerCode}
        </code>
      );
    }

    // Italic: *text*
    if (part.startsWith('*') && part.endsWith('*') && part.length >= 2) {
      return (
        <em key={i} className="italic">
          {part.slice(1, -1)}
        </em>
      );
    }

    return <React.Fragment key={i}>{part}</React.Fragment>;
  });
}

interface MarkdownMessageProps {
  content: string;
  onSelectRequirement?: (reqId: string) => void;
}

export function MarkdownMessage({ content, onSelectRequirement }: MarkdownMessageProps) {
  // Strip requirement spec json block so it never renders raw inside the speech bubble
  // Strip echoed prompt preamble (e.g. "I reviewed your requirement for: **...**")
  const clean = content
    .replace(/```(?:json:spec)\s*[\s\S]*?```/gi, '')
    .replace(/```json\s*\{[\s\S]*?"(?:title|goal)"[\s\S]*?\}\s*```/gi, '')
    .replace(/^I reviewed your requirement for:?[^\n]*\n*/gim, '')
    .trim();

  const lines = clean.split('\n');
  const blocks: React.ReactNode[] = [];
  let i = 0;

  while (i < lines.length) {
    const rawLine = lines[i];
    const trimmed = rawLine.trim();

    // 1. Fenced Code Block: ```lang ... ```
    if (trimmed.startsWith('```')) {
      const langMatch = trimmed.match(/^```([a-zA-Z0-9_-]*)/);
      const language = langMatch ? langMatch[1] : '';
      i++;
      const codeLines: string[] = [];
      while (i < lines.length && !lines[i].trim().startsWith('```')) {
        codeLines.push(lines[i]);
        i++;
      }
      if (i < lines.length && lines[i].trim().startsWith('```')) {
        i++; // skip closing ```
      }
      blocks.push(
        <CodeBlock
          key={`code-${i}`}
          language={language}
          code={codeLines.join('\n')}
        />
      );
      continue;
    }

    // 2. Markdown Table (| Header 1 | Header 2 |)
    if (trimmed.startsWith('|') && trimmed.endsWith('|') && trimmed.length > 2) {
      const tableLines: string[] = [];
      while (
        i < lines.length &&
        lines[i].trim().startsWith('|') &&
        lines[i].trim().endsWith('|')
      ) {
        tableLines.push(lines[i].trim());
        i++;
      }
      if (tableLines.length >= 2) {
        const headerCells = tableLines[0]
          .split('|')
          .slice(1, -1)
          .map((c) => c.trim());
        // row 1 is separator | --- | --- |
        const bodyRows = tableLines.slice(2).map((row) =>
          row
            .split('|')
            .slice(1, -1)
            .map((c) => c.trim())
        );

        blocks.push(
          <div key={`table-${i}`} className="my-3 overflow-x-auto rounded-xl border border-slate-200 dark:border-[#2d2f3d]">
            <table className="min-w-full text-left text-xs border-collapse">
              <thead className="bg-slate-100 dark:bg-[#1f202c] text-slate-800 dark:text-slate-200 font-semibold border-b border-slate-200 dark:border-[#2d2f3d]">
                <tr>
                  {headerCells.map((h, hIdx) => (
                    <th key={hIdx} className="p-2.5 px-3">
                      {renderInlineMarkdown(h, onSelectRequirement)}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-[#252636]">
                {bodyRows.map((row, rIdx) => (
                  <tr
                    key={rIdx}
                    className="hover:bg-slate-50 dark:hover:bg-[#1a1b26] transition-colors"
                  >
                    {row.map((cell, cIdx) => (
                      <td key={cIdx} className="p-2.5 px-3">
                        {renderInlineMarkdown(cell, onSelectRequirement)}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        );
        continue;
      }
    }

    // 3. Horizontal Rule: ---, ***, ___
    if (/^(?:---|---|\*\*\*|___)\s*$/.test(trimmed)) {
      blocks.push(
        <hr key={`hr-${i}`} className="my-3 border-t border-slate-200 dark:border-[#2d2f3d]" />
      );
      i++;
      continue;
    }

    // 4. Headings
    if (trimmed.startsWith('# ')) {
      blocks.push(
        <h1 key={`h1-${i}`} className="text-base font-extrabold text-slate-900 dark:text-white pt-2 pb-1 border-b border-slate-200 dark:border-[#2d2f3d]">
          {renderInlineMarkdown(trimmed.replace(/^#\s+/, ''), onSelectRequirement)}
        </h1>
      );
      i++;
      continue;
    }
    if (trimmed.startsWith('## ')) {
      blocks.push(
        <h2 key={`h2-${i}`} className="text-sm font-bold text-slate-900 dark:text-white pt-2 pb-0.5">
          {renderInlineMarkdown(trimmed.replace(/^##\s+/, ''), onSelectRequirement)}
        </h2>
      );
      i++;
      continue;
    }
    if (trimmed.startsWith('### ')) {
      blocks.push(
        <h3 key={`h3-${i}`} className="text-xs font-bold text-slate-900 dark:text-white pt-1.5 pb-0.5">
          {renderInlineMarkdown(trimmed.replace(/^###\s+/, ''), onSelectRequirement)}
        </h3>
      );
      i++;
      continue;
    }
    if (trimmed.startsWith('#### ')) {
      blocks.push(
        <h4 key={`h4-${i}`} className="text-xs font-semibold text-slate-800 dark:text-slate-200 pt-1">
          {renderInlineMarkdown(trimmed.replace(/^####\s+/, ''), onSelectRequirement)}
        </h4>
      );
      i++;
      continue;
    }

    // 5. Blockquote: > ...
    if (trimmed.startsWith('> ')) {
      blocks.push(
        <blockquote key={`quote-${i}`} className="my-1.5 pl-3 py-1 border-l-2 border-purple-500 bg-purple-50/50 dark:bg-purple-950/20 text-slate-700 dark:text-slate-300 italic rounded-r-md text-xs">
          {renderInlineMarkdown(trimmed.replace(/^>\s+/, ''), onSelectRequirement)}
        </blockquote>
      );
      i++;
      continue;
    }

    // 6. Unordered List Items: - or *
    if (/^[-*]\s+/.test(trimmed)) {
      const items: string[] = [];
      while (i < lines.length && /^[-*]\s+/.test(lines[i].trim())) {
        items.push(lines[i].trim().replace(/^[-*]\s+/, ''));
        i++;
      }
      blocks.push(
        <div key={`ul-${i}`} className="space-y-1 my-1 pl-1">
          {items.map((item, idx) => (
            <div key={idx} className="flex items-start gap-2">
              <span className="text-purple-500 font-bold leading-5 select-none">•</span>
              <div className="flex-1 leading-relaxed">{renderInlineMarkdown(item, onSelectRequirement)}</div>
            </div>
          ))}
        </div>
      );
      continue;
    }

    // 7. Ordered List Items: 1. 2.
    if (/^\d+\.\s+/.test(trimmed)) {
      const items: { num: string; text: string }[] = [];
      while (i < lines.length && /^\d+\.\s+/.test(lines[i].trim())) {
        const m = lines[i].trim().match(/^(\d+)\.\s+(.*)/);
        if (m) {
          items.push({ num: m[1], text: m[2] });
        }
        i++;
      }
      blocks.push(
        <div key={`ol-${i}`} className="space-y-1 my-1 pl-1">
          {items.map((item, idx) => (
            <div key={idx} className="flex items-start gap-2">
              <span className="text-purple-600 dark:text-purple-400 font-bold font-mono text-[10px] leading-5 select-none">
                {item.num}.
              </span>
              <div className="flex-1 leading-relaxed">{renderInlineMarkdown(item.text, onSelectRequirement)}</div>
            </div>
          ))}
        </div>
      );
      continue;
    }

    // 8. Empty lines
    if (!trimmed) {
      blocks.push(<div key={`blank-${i}`} className="h-1.5" />);
      i++;
      continue;
    }

    // 9. Standard Paragraph
    blocks.push(
      <p key={`p-${i}`} className="leading-relaxed">
        {renderInlineMarkdown(rawLine, onSelectRequirement)}
      </p>
    );
    i++;
  }

  return <div className="space-y-1 text-xs">{blocks}</div>;
}
