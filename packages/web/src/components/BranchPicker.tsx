import { useMemo, useState, type KeyboardEvent } from 'react';
import { Check, GitBranch, Plus } from 'lucide-react';
import { Popover, PopoverContent, PopoverTrigger } from './ui/popover.js';
import { cn } from './ui/sheet.js';
import { branchOptions, type BranchOption } from '../lib/runSettings.js';
import type { BranchEntry } from '../lib/runSettingsApi.js';

interface BranchPickerProps {
  value: string;
  onChange: (value: string) => void;
  entries: BranchEntry[];
  chosenProjects: string[];
  disabled?: boolean;
}

const BASE_ROW: BranchOption = { name: '', detail: "each repository's base branch", create: false };

/** Target branch: an existing branch of the chosen repositories, a new name, or each repository's base branch. */
export function BranchPicker({ value, onChange, entries, chosenProjects, disabled }: BranchPickerProps) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const rows = useMemo(() => [BASE_ROW, ...branchOptions(entries, query, chosenProjects)], [entries, query, chosenProjects]);

  const choose = (name: string) => {
    onChange(name);
    setOpen(false);
    setQuery('');
  };
  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActive((i) => Math.min(i + 1, rows.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActive((i) => Math.max(i - 1, 0));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      const row = rows[active];
      if (row) choose(row.name);
    }
  };

  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        setActive(0);
      }}
    >
      <PopoverTrigger asChild>
        <button
          type="button"
          disabled={disabled}
          className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border border-slate-200 dark:border-[#2e303d] text-xs text-slate-700 dark:text-slate-200 disabled:opacity-60"
        >
          <GitBranch className="w-3.5 h-3.5 text-[#7b68ee]" />
          <span className="font-mono">{value || 'Base branch of each repository'}</span>
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-80 p-2 space-y-2">
        <input
          autoFocus
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setActive(0);
          }}
          onKeyDown={onKeyDown}
          placeholder="Find a branch or type a new one, e.g. release/1.3"
          aria-label="Target branch"
          aria-controls="target-branch-options"
          aria-activedescendant={`target-branch-${active}`}
          className="w-full rounded-lg border border-slate-200 dark:border-[#2e303d] bg-white dark:bg-[#1a1b23] px-2.5 py-1.5 text-xs"
        />
        <div id="target-branch-options" role="listbox" aria-label="Branches" className="max-h-60 overflow-y-auto space-y-0.5">
          {rows.map((row, i) => (
            <button
              key={`${row.create ? 'create' : 'branch'}-${row.name}`}
              id={`target-branch-${i}`}
              type="button"
              role="option"
              aria-selected={i === active}
              onMouseEnter={() => setActive(i)}
              onClick={() => choose(row.name)}
              className={cn('w-full text-left px-2 py-1.5 rounded-lg text-xs', i === active && 'bg-[#7b68ee]/10')}
            >
              <span className="flex items-center gap-1.5 font-mono text-slate-800 dark:text-slate-200">
                {row.create ? <Plus className="w-3 h-3" /> : value === row.name ? <Check className="w-3 h-3 text-[#7b68ee]" /> : <span className="w-3" />}
                {row.create ? `Create ${row.name}` : row.name || 'Base branch'}
              </span>
              <span className="block pl-[18px] text-[10px] text-slate-500">{row.detail}</span>
            </button>
          ))}
        </div>
      </PopoverContent>
    </Popover>
  );
}
