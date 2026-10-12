import { Search, X } from 'lucide-react';
import { RepositoryFilter } from './RepositoryFilter.js';

interface QueueFilterBarProps {
  search: string;
  onSearchChange: (value: string) => void;
  projects: string[];
  project: string | null;
  onProjectChange: (project: string | null) => void;
}

/** Text search and repository filter above the queue list. */
export function QueueFilterBar({ search, onSearchChange, projects, project, onProjectChange }: QueueFilterBarProps) {
  return (
    <div className="flex flex-wrap items-center gap-2.5">
      <div className="relative flex-1 min-w-[14rem] max-w-md">
        <Search className="w-3.5 h-3.5 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />
        <input
          type="text"
          value={search}
          onChange={(e) => onSearchChange(e.target.value)}
          placeholder="Search tasks"
          aria-label="Search tasks"
          title="Matches the task, requirement, repository, branch and engine ID"
          className="w-full pl-8 pr-8 py-1.5 text-xs rounded-lg border border-slate-200 dark:border-[#333333] bg-white dark:bg-[#262626] text-slate-800 dark:text-slate-200 placeholder:text-slate-400 outline-none focus:border-purple-500 focus:ring-2 focus:ring-[#7b68ee]/30"
        />
        {search && (
          <button
            type="button"
            onClick={() => onSearchChange('')}
            aria-label="Clear search"
            className="absolute right-2 top-1/2 -translate-y-1/2 p-0.5 rounded text-slate-400 hover:text-slate-700 dark:hover:text-slate-200"
          >
            <X className="w-3 h-3" />
          </button>
        )}
      </div>
      <RepositoryFilter projects={projects} value={project} onChange={onProjectChange} />
    </div>
  );
}
