import { Fragment, useMemo, useRef, useState, type KeyboardEvent, type RefObject } from 'react';
import { Popover, PopoverAnchor, PopoverContent } from './ui/popover.js';
import { cn } from './ui/sheet.js';
import { findTrigger, insertMention, mentionItems, type MentionMatch, type MentionSources } from '../lib/mentions.js';

interface MentionTextareaProps {
  value: string;
  onChange: (value: string) => void;
  sources: MentionSources;
  ariaLabel: string;
  placeholder?: string;
  disabled?: boolean;
  maxLength?: number;
  rows?: number;
  className?: string;
  /** For a toolbar that formats the selection. */
  textareaRef?: RefObject<HTMLTextAreaElement>;
}

/** A textarea where # and @ open a picker, as in AI chat: files on the branch, repositories, requirements, shared assets. */
export function MentionTextarea({
  value, onChange, sources, ariaLabel, placeholder, disabled, maxLength, rows = 2, className, textareaRef,
}: MentionTextareaProps) {
  const ownRef = useRef<HTMLTextAreaElement>(null);
  const ref = textareaRef ?? ownRef;
  const [match, setMatch] = useState<MentionMatch | null>(null);
  const [active, setActive] = useState(0);
  const items = useMemo(() => (match ? mentionItems(match.trigger, match.query, sources) : []), [match, sources]);
  const open = Boolean(match) && items.length > 0;

  const track = (text: string, cursor: number) => {
    setMatch(findTrigger(text, cursor));
    setActive(0);
  };
  const pick = (picked: string) => {
    if (!match) return;
    const next = insertMention(value, match, picked);
    onChange(next.text);
    setMatch(null);
    requestAnimationFrame(() => {
      ref.current?.focus();
      ref.current?.setSelectionRange(next.cursor, next.cursor);
    });
  };
  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (!open) return;
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActive((i) => (i + 1) % items.length);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActive((i) => (i - 1 + items.length) % items.length);
    } else if (e.key === 'Enter' || e.key === 'Tab') {
      e.preventDefault();
      pick(items[active].value);
    } else if (e.key === 'Escape') {
      e.preventDefault();
      setMatch(null);
    }
  };

  return (
    <Popover open={open} onOpenChange={(next) => !next && setMatch(null)}>
      <PopoverAnchor asChild>
        <textarea
          ref={ref}
          value={value}
          onChange={(e) => {
            onChange(e.target.value);
            track(e.target.value, e.target.selectionStart);
          }}
          onKeyDown={onKeyDown}
          onClick={(e) => track(value, e.currentTarget.selectionStart)}
          rows={rows}
          maxLength={maxLength}
          disabled={disabled}
          aria-label={ariaLabel}
          aria-autocomplete="list"
          aria-expanded={open}
          placeholder={placeholder}
          className={className}
        />
      </PopoverAnchor>
      <PopoverContent
        align="start"
        side="bottom"
        className="w-80 max-h-64 overflow-y-auto p-1"
        onOpenAutoFocus={(e) => e.preventDefault()}
        onCloseAutoFocus={(e) => e.preventDefault()}
      >
        <div role="listbox" aria-label={match?.trigger === '@' ? 'Shared assets' : 'Files, repositories and requirements'}>
          {items.map((item, i) => (
            <Fragment key={item.key}>
              {(i === 0 || items[i - 1].group !== item.group) && (
                <div className="px-2 pt-1.5 pb-0.5 text-[9px] font-bold uppercase tracking-wider text-slate-400">{item.group}</div>
              )}
              <button
                type="button"
                role="option"
                aria-selected={i === active}
                onMouseDown={(e) => e.preventDefault()}
                onMouseEnter={() => setActive(i)}
                onClick={() => pick(item.value)}
                className={cn('w-full text-left px-2 py-1 rounded flex items-baseline gap-2 text-xs', i === active && 'bg-[#7b68ee]/10')}
              >
                <span className="font-mono text-slate-800 dark:text-slate-200 truncate">
                  {match?.trigger}
                  {item.value}
                </span>
                {item.detail && <span className="text-[10px] text-slate-500 truncate">{item.detail}</span>}
              </button>
            </Fragment>
          ))}
        </div>
      </PopoverContent>
    </Popover>
  );
}
