import { useState, useMemo } from 'react';
import {
  Building2,
  Check,
  ChevronsUpDown,
  Plus,
  Search,
  X,
  FolderGit2,
} from 'lucide-react';
import { Workspace } from '@sp-kickstack/shared';
import { Popover, PopoverTrigger, PopoverContent } from './ui/popover.js';

export interface WorkspaceSelectProps {
  value: string;
  onValueChange: (workspaceId: string) => void;
  workspaces: Workspace[];
  onCreateNew?: () => void;
  className?: string;
  compact?: boolean;
}

export function WorkspaceSelect({
  value,
  onValueChange,
  workspaces,
  onCreateNew,
  className = '',
  compact = false,
}: WorkspaceSelectProps) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');

  const activeWs = useMemo(() => {
    return workspaces.find((w) => w.id === value);
  }, [workspaces, value]);

  const filteredWorkspaces = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return workspaces;
    return workspaces.filter(
      (w) =>
        w.name.toLowerCase().includes(q) ||
        w.id.toLowerCase().includes(q) ||
        w.description?.toLowerCase().includes(q)
    );
  }, [workspaces, search]);

  const activeTitle = useMemo(() => {
    return activeWs?.name || value || 'default';
  }, [value, activeWs]);

  const handleSelect = (wsId: string) => {
    onValueChange(wsId);
    setOpen(false);
    setSearch('');
  };

  const handleCreateNew = () => {
    setOpen(false);
    setSearch('');
    onCreateNew?.();
  };

  if (compact) {
    return (
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <button
            type="button"
            className={`p-2 rounded-lg text-slate-400 hover:text-purple-600 dark:hover:text-purple-400 hover:bg-slate-100 dark:hover:bg-[#2a2a2a] transition-colors relative cursor-pointer ${className}`}
            title={`Active Workspace: ${activeTitle}`}
            aria-label="Select Active Workspace"
          >
            <Building2 className="w-4 h-4 text-[#7b68ee]" />
            <span className="absolute bottom-1 right-1 w-1.5 h-1.5 rounded-full bg-[#7b68ee]" />
          </button>
        </PopoverTrigger>

        <PopoverContent
          side="right"
          align="start"
          sideOffset={8}
          className="w-72 p-0 overflow-hidden shadow-2xl border-slate-200 dark:border-[#2e303d] bg-white dark:bg-[#1a1b23] z-50"
        >
          {renderDropdownBody()}
        </PopoverContent>
      </Popover>
    );
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          className={`flex-1 min-w-0 flex items-center justify-between gap-1.5 bg-slate-100 dark:bg-[#262626] border border-slate-200 dark:border-[#333333] hover:border-purple-300 dark:hover:border-purple-700/60 data-[state=open]:border-purple-500 rounded-lg px-2 py-1.5 text-xs font-semibold text-slate-800 dark:text-slate-200 transition-colors cursor-pointer group text-left ${className}`}
          title="Select Active Workspace"
          aria-label="Select Active Workspace"
        >
          <div className="flex items-center gap-1.5 min-w-0">
            <Building2 className="w-3.5 h-3.5 text-[#7b68ee] shrink-0" />
            <span className="truncate text-xs font-semibold">
              {activeTitle}
            </span>
          </div>
          <ChevronsUpDown className="w-3.5 h-3.5 text-slate-400 group-hover:text-slate-600 dark:group-hover:text-slate-300 shrink-0" />
        </button>
      </PopoverTrigger>

      <PopoverContent
        side="bottom"
        align="start"
        sideOffset={6}
        className="w-72 p-0 overflow-hidden shadow-2xl border-slate-200 dark:border-[#2e303d] bg-white dark:bg-[#1a1b23] z-50"
      >
        {renderDropdownBody()}
      </PopoverContent>
    </Popover>
  );

  function renderDropdownBody() {
    return (
      <div className="flex flex-col text-xs">
        {/* Header & Quick Filter Input */}
        <div className="p-2.5 border-b border-slate-200/80 dark:border-[#2a2c3d] bg-slate-50/70 dark:bg-[#161720]">
          <div className="relative flex items-center">
            <Search className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 pointer-events-none" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Filter workspaces..."
              className="w-full pl-8 pr-7 py-1.5 bg-white dark:bg-[#222430] border border-slate-200 dark:border-[#323547] rounded-md text-xs text-slate-800 dark:text-slate-200 placeholder:text-slate-400 focus:outline-none focus:border-purple-500 transition-colors"
              autoFocus
            />
            {search && (
              <button
                type="button"
                onClick={() => setSearch('')}
                className="absolute right-2 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200"
              >
                <X className="w-3 h-3" />
              </button>
            )}
          </div>
        </div>

        {/* Options List */}
        <div className="p-1.5 max-h-60 overflow-y-auto space-y-0.5">
          {/* Workspaces list */}
          {filteredWorkspaces.map((ws) => {
            const isSelected = ws.id === value;
            return (
              <button
                key={ws.id}
                type="button"
                onClick={() => handleSelect(ws.id)}
                className={`w-full flex items-center justify-between px-2.5 py-2 rounded-md transition-colors text-left cursor-pointer ${
                  isSelected
                    ? 'bg-purple-100 dark:bg-purple-950/60 text-[#7b68ee] font-bold'
                    : 'text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-[#252735]'
                }`}
              >
                <div className="flex items-center gap-2 min-w-0">
                  <FolderGit2 className="w-3.5 h-3.5 text-[#7b68ee] shrink-0" />
                  <div className="min-w-0">
                    <div className="font-semibold truncate">{ws.name}</div>
                    <div className="text-[10px] text-slate-400 dark:text-slate-500 font-mono truncate">
                      {ws.id}
                    </div>
                  </div>
                </div>
                {isSelected && (
                  <Check className="w-4 h-4 text-[#7b68ee] shrink-0 ml-2" />
                )}
              </button>
            );
          })}

          {/* Fallback option if activeWorkspaceId is not in list */}
          {value &&
            !workspaces.some((ws) => ws.id === value) &&
            (!search || value.toLowerCase().includes(search.toLowerCase())) && (
              <button
                type="button"
                onClick={() => handleSelect(value)}
                className="w-full flex items-center justify-between px-2.5 py-2 rounded-md bg-purple-100 dark:bg-purple-950/60 text-[#7b68ee] font-bold text-left cursor-pointer"
              >
                <div className="flex items-center gap-2 min-w-0">
                  <Building2 className="w-3.5 h-3.5 text-[#7b68ee] shrink-0" />
                  <div className="min-w-0 font-semibold truncate">{value}</div>
                </div>
                <Check className="w-4 h-4 text-[#7b68ee] shrink-0 ml-2" />
              </button>
            )}

          {/* Empty state */}
          {filteredWorkspaces.length === 0 && search && (
            <div className="p-3 text-center text-xs text-slate-400">
              No workspaces matching &ldquo;{search}&rdquo;
            </div>
          )}
        </div>

        {/* Footer: Create Workspace */}
        {onCreateNew && (
          <div className="p-2 border-t border-slate-200/80 dark:border-[#2a2c3d] bg-slate-50/70 dark:bg-[#161720]">
            <button
              type="button"
              onClick={handleCreateNew}
              className="w-full flex items-center justify-center gap-1.5 px-2.5 py-1.5 rounded-md text-xs font-semibold text-purple-700 dark:text-purple-300 hover:bg-purple-100/70 dark:hover:bg-purple-950/60 transition-colors cursor-pointer"
            >
              <Plus className="w-3.5 h-3.5" />
              <span>Create New Workspace</span>
            </button>
          </div>
        )}
      </div>
    );
  }
}
