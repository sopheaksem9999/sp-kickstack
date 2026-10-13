import { useRef, useState, type KeyboardEvent } from 'react';
import { Check, ChevronsUpDown, FolderGit2 } from 'lucide-react';
import { Popover, PopoverContent, PopoverTrigger } from '../ui/popover.js';
import { cn } from '../ui/sheet.js';
import { extendTypeahead, isTypingAhead, listboxTarget, typeaheadMatch, type TypeaheadState } from '../../lib/listboxNav.js';

interface RepositoryFilterProps {
  /** Repository (project) names of the active workspace. */
  projects: string[];
  /** The chosen repository, or null for all of them. */
  value: string | null;
  onChange: (project: string | null) => void;
}

const ALL = 'All repositories';

/**
 * Picker for the repository filter: a Radix popover with a listbox. Only the active option is in the Tab
 * order; arrow keys, Home, End and typing letters move it, Enter chooses, and Tab or Escape close the list.
 */
export function RepositoryFilter({ projects, value, onChange }: RepositoryFilterProps) {
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const listRef = useRef<HTMLDivElement>(null);
  const typed = useRef<TypeaheadState>({ text: '', at: 0 });
  const label = value ?? ALL;
  // The first option is "all repositories" (null); the others are the repositories in order.
  const names: Array<string | null> = [null, ...projects];
  const labels = names.map((name) => name ?? ALL);
  const selectedIndex = Math.max(names.indexOf(value), 0);
  // The list can shrink while it is open (another workspace); keep one option in the Tab order.
  const activeIndex = Math.min(active, names.length - 1);

  const choose = (next: string | null) => {
    onChange(next);
    setOpen(false);
  };

  const openChange = (next: boolean) => {
    if (next) setActive(selectedIndex);
    setOpen(next);
  };

  const options = () => Array.from(listRef.current?.querySelectorAll<HTMLButtonElement>('[role="option"]') ?? []);

  const moveTo = (index: number) => {
    setActive(index);
    options()[index]?.focus();
  };

  const onListKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    // Tab leaves the list: close it, and focus goes back to the button that opened it.
    if (event.key === 'Tab') {
      event.preventDefault();
      setOpen(false);
      return;
    }
    const target = listboxTarget(event.key, activeIndex, names.length);
    if (target !== null) {
      event.preventDefault();
      moveTo(target);
      return;
    }
    // Type-ahead: a letter or digit (or a space inside a word) goes to the next option starting with it.
    const now = Date.now();
    const isCharacter = event.key.length === 1 && !event.ctrlKey && !event.metaKey && !event.altKey;
    if (!isCharacter || (event.key === ' ' && !isTypingAhead(typed.current, now))) return;
    event.preventDefault();
    typed.current = extendTypeahead(typed.current, event.key, now);
    const match = typeaheadMatch(labels, activeIndex, typed.current.text);
    if (match >= 0) moveTo(match);
  };

  const row = (name: string | null, index: number) => {
    const selected = name === value;
    return (
      <button
        key={name ?? ALL}
        type="button"
        role="option"
        aria-selected={selected}
        tabIndex={index === activeIndex ? 0 : -1}
        onFocus={() => setActive(index)}
        onClick={() => choose(name)}
        className={cn(
          'w-full flex items-center justify-between gap-2 px-2.5 py-2 rounded-md text-left text-xs transition-colors outline-none focus-visible:ring-2 focus-visible:ring-[#7b68ee]/50',
          selected
            ? 'bg-purple-100 dark:bg-purple-950/60 text-[#7b68ee] font-bold'
            : 'text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-[#252735]'
        )}
      >
        <span className="flex items-center gap-2 min-w-0">
          <FolderGit2 className="w-3.5 h-3.5 shrink-0 text-[#7b68ee]" />
          <span className="truncate font-semibold">{labels[index]}</span>
        </span>
        {selected && <Check className="w-4 h-4 shrink-0 text-[#7b68ee]" />}
      </button>
    );
  };

  return (
    <Popover open={open} onOpenChange={openChange}>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label={`Filter by repository, showing ${label}`}
          className="flex items-center justify-between gap-2 min-w-[11rem] max-w-full px-3 py-1.5 rounded-lg border border-slate-200 dark:border-[#333333] bg-white dark:bg-[#262626] hover:border-purple-300 dark:hover:border-purple-700/60 data-[state=open]:border-purple-500 text-xs font-semibold text-slate-700 dark:text-slate-200 transition-colors cursor-pointer"
        >
          <span className="flex items-center gap-1.5 min-w-0">
            <FolderGit2 className="w-3.5 h-3.5 shrink-0 text-[#7b68ee]" />
            <span className="truncate">{label}</span>
          </span>
          <ChevronsUpDown className="w-3.5 h-3.5 shrink-0 text-slate-400" />
        </button>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        aria-label="Choose a repository"
        className="w-64 p-1.5"
        onOpenAutoFocus={(event) => {
          // Land on the current choice so Arrow keys, letters and Enter work at once.
          event.preventDefault();
          options()[selectedIndex]?.focus();
        }}
      >
        <div ref={listRef} role="listbox" aria-label="Repositories" onKeyDown={onListKeyDown} className="max-h-64 overflow-y-auto space-y-0.5">
          {names.map((name, index) => row(name, index))}
        </div>
        {projects.length === 0 && (
          <p className="px-2.5 py-2 text-[11px] text-slate-500 dark:text-slate-400">
            This workspace has no repositories yet. Add one on the Repositories page.
          </p>
        )}
      </PopoverContent>
    </Popover>
  );
}
