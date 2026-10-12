import React, { useState } from 'react';
import { useQuery, useMutation } from '@tanstack/react-query';
import {
  Laptop,
  Code2,
  ChevronDown,
  Check,
  FolderOpen,
  Sparkles,
  Command,
  Loader2,
} from 'lucide-react';
import { toast } from 'sonner';
import { fetchDetectedIdes, openProjectInIde, openProjectFolder } from '../lib/api.js';
import {
  Popover,
  PopoverTrigger,
  PopoverContent,
} from './ui/popover.js';

interface OpenInIdeButtonProps {
  projectName: string;
  repoPath?: string;
  variant?: 'card' | 'split' | 'modal' | 'icon';
  className?: string;
}

/**
 * Returns an appropriate icon or brand color for known IDE IDs
 */
function getIdeIcon(id: string) {
  switch (id) {
    case 'antigravity':
      return <Sparkles className="w-3.5 h-3.5 text-purple-400" />;
    case 'vscode':
      return <Code2 className="w-3.5 h-3.5 text-blue-400" />;
    case 'cursor':
      return <Command className="w-3.5 h-3.5 text-cyan-400" />;
    case 'windsurf':
      return <Laptop className="w-3.5 h-3.5 text-teal-400" />;
    case 'trae':
      return <Code2 className="w-3.5 h-3.5 text-indigo-400" />;
    case 'zed':
      return <Code2 className="w-3.5 h-3.5 text-amber-400" />;
    default:
      return <Laptop className="w-3.5 h-3.5 text-slate-400" />;
  }
}

export const OpenInIdeButton: React.FC<OpenInIdeButtonProps> = ({
  projectName,
  repoPath: _repoPath,
  variant = 'card',
  className = '',
}) => {
  const [isOpen, setIsOpen] = useState(false);

  const { data: detectedIdes = [] } = useQuery({
    queryKey: ['detected-ides'],
    queryFn: fetchDetectedIdes,
    staleTime: 60_000,
  });

  const openMutation = useMutation({
    mutationFn: (ideId?: string) => openProjectInIde(projectName, ideId),
    onSuccess: (data) => {
      toast.success(`Opened ${projectName} in ${data.ide?.name || 'IDE'}`);
      setIsOpen(false);
    },
    onError: (err: any) => {
      toast.error(err.message || 'Failed to open project in IDE');
    },
  });

  const openFolderMutation = useMutation({
    mutationFn: () => openProjectFolder(projectName),
    onSuccess: () => {
      toast.success(`Revealed folder in file manager`);
      setIsOpen(false);
    },
    onError: (err: any) => {
      toast.error(err.message || 'Failed to reveal folder');
    },
  });

  const defaultIde = detectedIdes.find((d) => d.isDefault) || detectedIdes[0];
  const isPending = openMutation.isPending || openFolderMutation.isPending;

  // Render for Modal Variant (prominent action button with menu)
  if (variant === 'modal') {
    return (
      <div className={`relative inline-flex items-center rounded-lg shadow-xs ${className}`}>
        <button
          type="button"
          onClick={() => openMutation.mutate(defaultIde?.id)}
          disabled={isPending}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-l-lg text-xs font-bold text-white bg-indigo-600 hover:bg-indigo-500 shadow-sm transition disabled:opacity-50"
          title={defaultIde ? `Open project in ${defaultIde.name}` : 'Open in IDE'}
        >
          {isPending ? (
            <Loader2 className="w-3.5 h-3.5 animate-spin" />
          ) : defaultIde ? (
            getIdeIcon(defaultIde.id)
          ) : (
            <Laptop className="w-3.5 h-3.5" />
          )}
          <span>{defaultIde ? `Open in ${defaultIde.name}` : 'Open in IDE'}</span>
        </button>

        <Popover open={isOpen} onOpenChange={setIsOpen}>
          <PopoverTrigger asChild>
            <button
              type="button"
              className="px-1.5 py-1.5 rounded-r-lg border-l border-indigo-700 bg-indigo-600 hover:bg-indigo-500 text-white transition"
              title="Select IDE to open"
            >
              <ChevronDown className="w-3.5 h-3.5" />
            </button>
          </PopoverTrigger>

          <PopoverContent align="end" className="w-64 p-2 bg-[#14151f] border-slate-800 text-slate-200">
            <div className="px-2 py-1.5 text-[11px] font-bold uppercase tracking-wider text-slate-400 border-b border-slate-800/80 mb-1">
              Open in Installed IDE
            </div>

            <div className="space-y-0.5">
              {detectedIdes.map((ide) => (
                <button
                  key={ide.id}
                  type="button"
                  onClick={() => openMutation.mutate(ide.id)}
                  disabled={isPending}
                  className="w-full flex items-center justify-between px-2.5 py-1.5 rounded-md hover:bg-purple-950/60 hover:text-white text-xs text-left transition group"
                >
                  <div className="flex items-center gap-2">
                    {getIdeIcon(ide.id)}
                    <span className="font-semibold">{ide.name}</span>
                  </div>
                  {ide.isDefault && (
                    <span className="flex items-center gap-1 text-[10px] text-purple-400 font-mono">
                      <Check className="w-3 h-3" /> default
                    </span>
                  )}
                </button>
              ))}

              {detectedIdes.length === 0 && (
                <button
                  type="button"
                  onClick={() => openMutation.mutate(undefined)}
                  className="w-full flex items-center gap-2 px-2.5 py-1.5 rounded-md hover:bg-slate-800 text-xs text-left transition"
                >
                  <Laptop className="w-3.5 h-3.5 text-slate-400" />
                  <span>Default Editor (VS Code / system)</span>
                </button>
              )}
            </div>

            <div className="mt-2 pt-1.5 border-t border-slate-800/80">
              <button
                type="button"
                onClick={() => openFolderMutation.mutate()}
                className="w-full flex items-center gap-2 px-2.5 py-1.5 rounded-md hover:bg-slate-800 text-slate-400 hover:text-slate-200 text-xs transition"
              >
                <FolderOpen className="w-3.5 h-3.5" />
                <span>Reveal in File Manager</span>
              </button>
            </div>
          </PopoverContent>
        </Popover>
      </div>
    );
  }

  // Render for Split Header Variant
  if (variant === 'split') {
    return (
      <div className={`relative inline-flex items-center ${className}`}>
        <Popover open={isOpen} onOpenChange={setIsOpen}>
          <div className="inline-flex items-center rounded-lg bg-slate-900 border border-slate-800">
            <button
              type="button"
              onClick={() => openMutation.mutate(defaultIde?.id)}
              disabled={isPending}
              className="flex items-center gap-1.5 px-2.5 py-1 rounded-l-lg hover:bg-slate-800 text-slate-200 hover:text-white text-xs font-semibold transition disabled:opacity-50"
              title={defaultIde ? `Open in ${defaultIde.name}` : 'Open in IDE'}
            >
              {isPending ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin text-purple-400" />
              ) : defaultIde ? (
                getIdeIcon(defaultIde.id)
              ) : (
                <Laptop className="w-3.5 h-3.5 text-slate-400" />
              )}
              <span>{defaultIde ? defaultIde.name : 'Open IDE'}</span>
            </button>

            <PopoverTrigger asChild>
              <button
                type="button"
                className="px-1.5 py-1 rounded-r-lg border-l border-slate-800/80 hover:bg-slate-800 text-slate-400 hover:text-white transition"
                title="Choose IDE to open"
              >
                <ChevronDown className="w-3 h-3" />
              </button>
            </PopoverTrigger>
          </div>

          <PopoverContent align="end" className="w-64 p-2 bg-[#12131c] border-slate-800 text-slate-200 shadow-xl">
            <div className="px-2 py-1 text-[10px] font-bold uppercase tracking-wider text-slate-400 border-b border-slate-800/80 mb-1 flex items-center justify-between">
              <span>Installed IDEs on PC</span>
              <span className="text-purple-400 font-mono text-[9px]">{detectedIdes.length} found</span>
            </div>

            <div className="space-y-0.5">
              {detectedIdes.map((ide) => (
                <button
                  key={ide.id}
                  type="button"
                  onClick={() => openMutation.mutate(ide.id)}
                  disabled={isPending}
                  className="w-full flex items-center justify-between px-2.5 py-1.5 rounded-md hover:bg-purple-950/60 hover:text-white text-xs text-left transition"
                >
                  <div className="flex items-center gap-2">
                    {getIdeIcon(ide.id)}
                    <span className="font-semibold">{ide.name}</span>
                  </div>
                  {ide.isDefault && (
                    <span className="flex items-center gap-1 text-[10px] text-purple-400 font-mono">
                      <Check className="w-3 h-3" /> default
                    </span>
                  )}
                </button>
              ))}

              {detectedIdes.length === 0 && (
                <button
                  type="button"
                  onClick={() => openMutation.mutate(undefined)}
                  className="w-full flex items-center gap-2 px-2.5 py-1.5 rounded-md hover:bg-slate-800 text-xs text-left transition"
                >
                  <Laptop className="w-3.5 h-3.5 text-slate-400" />
                  <span>Default Editor</span>
                </button>
              )}
            </div>

            <div className="mt-2 pt-1.5 border-t border-slate-800/80">
              <button
                type="button"
                onClick={() => openFolderMutation.mutate()}
                className="w-full flex items-center gap-2 px-2.5 py-1.5 rounded-md hover:bg-slate-800 text-slate-400 hover:text-slate-200 text-xs transition"
              >
                <FolderOpen className="w-3.5 h-3.5" />
                <span>Reveal in File Manager</span>
              </button>
            </div>
          </PopoverContent>
        </Popover>
      </div>
    );
  }

  // Render for Card / Default Variant
  return (
    <div className={`relative inline-flex items-center ${className}`}>
      <Popover open={isOpen} onOpenChange={setIsOpen}>
        <div className="inline-flex items-center rounded-lg bg-slate-100 dark:bg-slate-800/90 border border-slate-200 dark:border-slate-700/80 text-xs font-semibold">
          <button
            type="button"
            onClick={() => openMutation.mutate(defaultIde?.id)}
            disabled={isPending}
            className="flex items-center gap-1 px-2 py-1 rounded-l-lg hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200 hover:text-slate-900 dark:hover:text-white transition disabled:opacity-50"
            title={defaultIde ? `Open in ${defaultIde.name}` : 'Open in IDE'}
          >
            {isPending ? (
              <Loader2 className="w-3 h-3 animate-spin text-purple-500" />
            ) : defaultIde ? (
              getIdeIcon(defaultIde.id)
            ) : (
              <Laptop className="w-3 h-3 text-slate-400" />
            )}
            <span className="text-[11px] font-bold">
              {defaultIde ? defaultIde.name : 'Open IDE'}
            </span>
          </button>

          <PopoverTrigger asChild>
            <button
              type="button"
              className="px-1 py-1 rounded-r-lg border-l border-slate-200 dark:border-slate-700 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-500 hover:text-slate-800 dark:hover:text-white transition"
              title="More IDE options"
            >
              <ChevronDown className="w-3 h-3" />
            </button>
          </PopoverTrigger>
        </div>

        <PopoverContent align="end" className="w-60 p-2 bg-white dark:bg-[#161722] border-slate-200 dark:border-slate-800 text-slate-800 dark:text-slate-200 shadow-xl">
          <div className="px-2 py-1 text-[10px] font-bold uppercase tracking-wider text-slate-400 border-b border-slate-100 dark:border-slate-800/80 mb-1 flex items-center justify-between">
            <span>Open in IDE</span>
            {detectedIdes.length > 0 && (
              <span className="text-purple-600 dark:text-purple-400 font-mono text-[9px]">{detectedIdes.length} detected</span>
            )}
          </div>

          <div className="space-y-0.5">
            {detectedIdes.map((ide) => (
              <button
                key={ide.id}
                type="button"
                onClick={() => openMutation.mutate(ide.id)}
                disabled={isPending}
                className="w-full flex items-center justify-between px-2.5 py-1.5 rounded-md hover:bg-purple-50 dark:hover:bg-purple-950/60 hover:text-purple-900 dark:hover:text-white text-xs text-left transition"
              >
                <div className="flex items-center gap-2">
                  {getIdeIcon(ide.id)}
                  <span className="font-semibold text-slate-800 dark:text-slate-200">{ide.name}</span>
                </div>
                {ide.isDefault && (
                  <span className="flex items-center gap-1 text-[10px] text-purple-600 dark:text-purple-400 font-mono">
                    <Check className="w-3 h-3" /> default
                  </span>
                )}
              </button>
            ))}

            {detectedIdes.length === 0 && (
              <button
                type="button"
                onClick={() => openMutation.mutate(undefined)}
                className="w-full flex items-center gap-2 px-2.5 py-1.5 rounded-md hover:bg-slate-100 dark:hover:bg-slate-800 text-xs text-left transition"
              >
                <Laptop className="w-3.5 h-3.5 text-slate-400" />
                <span>Default Editor</span>
              </button>
            )}
          </div>

          <div className="mt-2 pt-1.5 border-t border-slate-100 dark:border-slate-800/80">
            <button
              type="button"
              onClick={() => openFolderMutation.mutate()}
              className="w-full flex items-center gap-2 px-2.5 py-1.5 rounded-md hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200 text-xs transition"
            >
              <FolderOpen className="w-3.5 h-3.5" />
              <span>Reveal in File Manager</span>
            </button>
          </div>
        </PopoverContent>
      </Popover>
    </div>
  );
};
