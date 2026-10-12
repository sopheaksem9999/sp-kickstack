import { useRef, useState, type KeyboardEvent } from 'react';
import { Check, ChevronsUpDown, FolderGit2 } from 'lucide-react';
import { Popover, PopoverContent, PopoverTrigger } from '../ui/popover.js';
import { cn } from '../ui/sheet.js';

interface RepositoryFilterProps {
  /** Repository (project) names of the active workspace. */
  projects: string[];
  /** The chosen repository, or null for all of them. */
  value: string | null;
  onChange: (project: string | null) => void;
}

const ALL = 'All repositories';

/** Picker for the repository filter: a Radix popover with a listbox; arrow keys, Home, End, Enter and Escape work. */
export function RepositoryFilter({ projects, value, onChange }: RepositoryFilterProps) {
  const [open, setOpen] = useState(false);
  const listRef = useRef<HTMLDivElement>(null);
  const label = value ?? ALL;

  const choose = (next: string | null) => {
    onChange(next);
    setOpen(false);
  };

  const moveFocus = (event: KeyboardEvent<HTMLDivElement>) => {
    const options = Array.from(listRef.current?.querySelectorAll<HTMLButtonElement>('[role="option"]') ?? []);
    const current = options.indexOf(document.activeElement as HTMLButtonElement);
    let next = -1;
    if (event.key === 'ArrowDown') next = Math.min(current + 1, options.length - 1);
    else if (event.key === 'ArrowUp') next = Math.max(current - 1, 0);
    else if (event.key === 'Home') next = 0;
    else if (event.key === 'End') next = options.length - 1;
    if (next < 0) return;
    event.preventDefault();
    options[next]?.focus();
  };

  const row = (name: string | null, text: string) => {
    const selected = name === value;
    return (
      <button
        key={name ?? ALL}
        type="button"
        role="option"
        aria-selected={selected}
        data-selected={selected}
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
          <span className="truncate font-semibold">{text}</span>
        </span>
        {selected && <Check className="w-4 h-4 shrink-0 text-[#7b68ee]" />}
      </button>
    );
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
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
        className="w-64 p-1.5"
        onOpenAutoFocus={(event) => {
          // Land on the current choice so Arrow keys and Enter work at once.
          event.preventDefault();
          listRef.current?.querySelector<HTMLButtonElement>('[data-selected="true"]')?.focus();
        }}
      >
        <div ref={listRef} role="listbox" aria-label="Repository" onKeyDown={moveFocus} className="max-h-64 overflow-y-auto space-y-0.5">
          {row(null, ALL)}
          {projects.map((name) => row(name, name))}
          {projects.length === 0 && (
            <p className="px-2.5 py-2 text-[11px] text-slate-500 dark:text-slate-400">
              This workspace has no repositories yet. Add one on the Repositories page.
            </p>
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}
