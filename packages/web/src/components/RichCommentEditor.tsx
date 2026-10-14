import { useRef, useState, type ChangeEvent, type Dispatch, type SetStateAction } from 'react';
import * as Tabs from '@radix-ui/react-tabs';
import { Bold, Code, FileCode, Italic, Link2, List, ListOrdered, Paperclip, X } from 'lucide-react';
import type { ReviewAttachmentUpload } from '@sp-kickstack/shared';
import { MentionTextarea } from './MentionTextarea.js';
import { MarkdownMessage } from './MarkdownMessage.js';
import { applyFormat, type FormatKind } from '../lib/markdownFormat.js';
import { fileSize } from '../lib/reviewActions.js';
import type { MentionSources } from '../lib/mentions.js';

/** A file picked for a comment, not saved yet. */
export type PendingFile = ReviewAttachmentUpload & { size: number };

/** The file types the requirement form takes, plus logs. */
const ACCEPT = 'image/*,.pdf,.txt,.log,.md,.json,.yaml,.yml,.csv,.xlsx,.xls';

const TOOLS: Array<{ kind: FormatKind; icon: typeof Bold; title: string }> = [
  { kind: 'bold', icon: Bold, title: 'Bold (**text**)' },
  { kind: 'italic', icon: Italic, title: 'Italic (*text*)' },
  { kind: 'code', icon: Code, title: 'Inline code (`code`)' },
  { kind: 'codeblock', icon: FileCode, title: 'Code block, for errors and logs' },
  { kind: 'bullet', icon: List, title: 'Bullet list (- item)' },
  { kind: 'numbered', icon: ListOrdered, title: 'Numbered list (1. item)' },
  { kind: 'link', icon: Link2, title: 'Link ([text](https://…))' },
];

const trigger =
  'px-2 py-0.5 rounded-md text-[11px] font-bold text-slate-500 data-[state=active]:bg-white dark:data-[state=active]:bg-[#1a1b23] data-[state=active]:text-slate-900 dark:data-[state=active]:text-white data-[state=active]:shadow-2xs';

function readFile(file: File): Promise<PendingFile> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve({ name: file.name, type: file.type || undefined, size: file.size, data_url: String(reader.result) });
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

interface RichCommentEditorProps {
  value: string;
  onChange: (value: string) => void;
  files?: PendingFile[];
  onFilesChange?: Dispatch<SetStateAction<PendingFile[]>>;
  /** false: no paperclip and no file chips (e.g. skill instructions). */
  allowFiles?: boolean;
  sources: MentionSources;
  ariaLabel: string;
  placeholder?: string;
  disabled?: boolean;
}

/** Markdown comment box like the requirement form: Write / Preview, a formatting toolbar, # and @ pickers, attached files. */
export function RichCommentEditor({
  value,
  onChange,
  files = [],
  onFilesChange = () => undefined,
  allowFiles = true,
  sources,
  ariaLabel,
  placeholder,
  disabled,
}: RichCommentEditorProps) {
  const textarea = useRef<HTMLTextAreaElement>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const [tab, setTab] = useState('write');

  const format = (kind: FormatKind) => {
    const el = textarea.current;
    const next = applyFormat(value, el?.selectionStart ?? value.length, el?.selectionEnd ?? value.length, kind);
    onChange(next.text);
    requestAnimationFrame(() => {
      el?.focus();
      el?.setSelectionRange(next.start, next.end);
    });
  };
  const addFiles = (e: ChangeEvent<HTMLInputElement>) => {
    const picked = Array.from(e.target.files ?? []);
    e.target.value = '';
    void Promise.all(picked.map(readFile)).then((read) => onFilesChange((prev) => [...prev, ...read]));
  };
  const tool = 'p-1 rounded text-slate-500 hover:bg-slate-100 dark:hover:bg-[#262732] hover:text-slate-800 dark:hover:text-slate-200 disabled:opacity-40';

  return (
    <div className="space-y-1.5">
      <Tabs.Root value={tab} onValueChange={setTab}>
        <div className="flex items-center justify-between gap-2 flex-wrap">
          <Tabs.List aria-label="Comment" className="inline-flex p-0.5 rounded-lg bg-slate-100 dark:bg-[#242424] border border-slate-200 dark:border-[#303030]">
            <Tabs.Trigger value="write" className={trigger}>
              Write
            </Tabs.Trigger>
            <Tabs.Trigger value="preview" className={trigger}>
              Preview
            </Tabs.Trigger>
          </Tabs.List>
          <div className="flex items-center gap-0.5" role="toolbar" aria-label="Formatting">
            {TOOLS.map(({ kind, icon: Icon, title }) => (
              <button
                key={kind}
                type="button"
                title={title}
                aria-label={title}
                disabled={disabled || tab !== 'write'}
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => format(kind)}
                className={tool}
              >
                <Icon className="w-3.5 h-3.5" />
              </button>
            ))}
            {allowFiles && (
              <>
                <span className="w-px h-4 mx-1 bg-slate-200 dark:bg-[#303030]" />
                <button type="button" title="Attach files" aria-label="Attach files" disabled={disabled} onClick={() => fileInput.current?.click()} className={tool}>
                  <Paperclip className="w-3.5 h-3.5" />
                </button>
              </>
            )}
          </div>
        </div>
        <Tabs.Content value="write" className="pt-1.5">
          <MentionTextarea
            textareaRef={textarea}
            value={value}
            onChange={onChange}
            sources={sources}
            rows={Math.min(12, Math.max(3, value.split('\n').length))}
            maxLength={20000}
            disabled={disabled}
            ariaLabel={ariaLabel}
            placeholder={placeholder}
            className="w-full rounded-lg border border-slate-200 dark:border-[#2e303d] bg-white dark:bg-[#1a1b23] px-2 py-1.5 text-xs disabled:opacity-60"
          />
        </Tabs.Content>
        <Tabs.Content value="preview" className="pt-1.5">
          <div className="min-h-[4.5rem] rounded-lg border border-slate-200 dark:border-[#2e303d] bg-white dark:bg-[#1a1b23] px-2 py-1.5 text-xs text-slate-700 dark:text-slate-300">
            {value.trim() ? <MarkdownMessage content={value} /> : <p className="text-slate-400">Nothing to preview yet.</p>}
          </div>
        </Tabs.Content>
      </Tabs.Root>

      {allowFiles && <input ref={fileInput} type="file" multiple accept={ACCEPT} className="hidden" onChange={addFiles} />}
      {allowFiles && files.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {files.map((file, i) => (
            <span key={`${file.name}-${i}`} className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-slate-100 dark:bg-[#242424] text-[11px]">
              <Paperclip className="w-3 h-3 text-slate-400" />
              <span className="font-mono truncate max-w-[12rem]">{file.name}</span>
              <span className="text-slate-400">{fileSize(file.size)}</span>
              <button
                type="button"
                aria-label={`Remove ${file.name}`}
                disabled={disabled}
                onClick={() => onFilesChange((prev) => prev.filter((_, j) => j !== i))}
                className="text-slate-400 hover:text-rose-500"
              >
                <X className="w-3 h-3" />
              </button>
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
