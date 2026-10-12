import { useState, useEffect, useMemo, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import {
  Search,
  Layers,
  Sparkles,
  Paperclip,
  FolderGit2,
  BarChart3,
  Settings,
  Building2,
  Plus,
  Moon,
  Sun,
  ArrowRight,
  FileText,
  X,
} from 'lucide-react';
import { Dialog, DialogContent, DialogTitle } from './ui/dialog.js';
import { useWorkspace } from '../lib/WorkspaceContext.js';
import { useTheme } from '../lib/ThemeContext.js';
import { useCreateRequirement } from '../lib/CreateRequirementContext.js';
import { fetchRequirements } from '../lib/api.js';

interface CommandPaletteModalProps {
  isOpen: boolean;
  onClose: () => void;
  onCreateWorkspace?: () => void;
  onOpenRequirementDetail?: (reqId: string) => void;
}

interface PaletteItem {
  id: string;
  category: 'Navigation' | 'Workspaces' | 'Requirements' | 'Actions';
  title: string;
  subtitle?: string;
  icon: any;
  badge?: string;
  action: () => void;
}

export function CommandPaletteModal({
  isOpen,
  onClose,
  onCreateWorkspace,
  onOpenRequirementDetail,
}: CommandPaletteModalProps) {
  const navigate = useNavigate();
  const { theme, toggleTheme } = useTheme();
  const { workspaces, activeWorkspaceId, setActiveWorkspaceId, wsPath } = useWorkspace();
  const { openSheet } = useCreateRequirement();

  const [query, setQuery] = useState('');
  const [selectedIndex, setSelectedIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement | null>(null);

  // Fetch requirements for active workspace
  const { data: requirements = [] } = useQuery({
    queryKey: ['requirements', activeWorkspaceId],
    queryFn: () => fetchRequirements(activeWorkspaceId),
    enabled: isOpen,
  });

  // Focus input when opened
  useEffect(() => {
    if (isOpen) {
      setQuery('');
      setSelectedIndex(0);
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  }, [isOpen]);

  // Build searchable items
  const items = useMemo<PaletteItem[]>(() => {
    const list: PaletteItem[] = [];

    // 1. Actions
    list.push({
      id: 'action-new-req',
      category: 'Actions',
      title: 'New Requirement',
      subtitle: 'Create a new ticket or project specification',
      icon: Plus,
      badge: 'Action',
      action: () => {
        onClose();
        openSheet();
      },
    });

    if (onCreateWorkspace) {
      list.push({
        id: 'action-new-ws',
        category: 'Actions',
        title: 'New Workspace',
        subtitle: 'Add a new project or team workspace',
        icon: Building2,
        badge: 'Action',
        action: () => {
          onClose();
          onCreateWorkspace();
        },
      });
    }

    list.push({
      id: 'action-toggle-theme',
      category: 'Actions',
      title: theme === 'dark' ? 'Switch to Light Mode' : 'Switch to Dark Mode',
      subtitle: `Currently in ${theme} mode`,
      icon: theme === 'dark' ? Sun : Moon,
      badge: 'Theme',
      action: () => {
        onClose();
        toggleTheme();
      },
    });

    // 2. Navigation Pages
    list.push({
      id: 'nav-requirements',
      category: 'Navigation',
      title: 'Requirements & Tasks',
      subtitle: 'Browse backlog, sprints, and ticket boards',
      icon: Layers,
      action: () => {
        onClose();
        navigate(wsPath('/requirements'));
      },
    });

    list.push({
      id: 'nav-chat',
      category: 'Navigation',
      title: 'AI Architect Chat',
      subtitle: 'Collaborate with AI on requirements, architectures, and fanouts',
      icon: Sparkles,
      action: () => {
        onClose();
        navigate(wsPath('/chat'));
      },
    });

    list.push({
      id: 'nav-attachments',
      category: 'Navigation',
      title: 'Attachments Hub',
      subtitle: 'Files, mockups, design documents, and shared assets',
      icon: Paperclip,
      action: () => {
        onClose();
        navigate(wsPath('/attachments'));
      },
    });

    list.push({
      id: 'nav-projects',
      category: 'Navigation',
      title: 'Repositories',
      subtitle: 'Git repos, branch gates, and diff reviewers',
      icon: FolderGit2,
      action: () => {
        onClose();
        navigate(wsPath('/projects'));
      },
    });

    list.push({
      id: 'nav-metrics',
      category: 'Navigation',
      title: 'Telemetry & Sprints',
      subtitle: 'Sprint velocity, execution logs, and worker health',
      icon: BarChart3,
      action: () => {
        onClose();
        navigate(wsPath('/metrics'));
      },
    });

    list.push({
      id: 'nav-settings',
      category: 'Navigation',
      title: 'Settings',
      subtitle: 'AI providers, branching policies, and bridge configuration',
      icon: Settings,
      action: () => {
        onClose();
        navigate(wsPath('/settings'));
      },
    });

    // 3. Workspaces

    workspaces.forEach((ws) => {
      list.push({
        id: `ws-${ws.id}`,
        category: 'Workspaces',
        title: ws.name,
        subtitle: `Workspace slug: ${ws.id}`,
        icon: Building2,
        badge: activeWorkspaceId === ws.id ? 'Active' : undefined,
        action: () => {
          onClose();
          setActiveWorkspaceId(ws.id);
        },
      });
    });

    // 4. Requirements / Tickets
    requirements.forEach((req) => {
      list.push({
        id: `req-${req.id}`,
        category: 'Requirements',
        title: `${req.id}: ${req.title}`,
        subtitle: `${req.status} · ${req.priority} priority`,
        icon: FileText,
        badge: req.status.toUpperCase(),
        action: () => {
          onClose();
          if (onOpenRequirementDetail) {
            onOpenRequirementDetail(req.id);
          } else {
            navigate(wsPath(`/requirements/${req.id}`));
          }
        },
      });
    });

    return list;
  }, [
    workspaces,
    activeWorkspaceId,
    requirements,
    theme,
    navigate,
    wsPath,
    onClose,
    openSheet,
    onCreateWorkspace,
    toggleTheme,
    setActiveWorkspaceId,
    onOpenRequirementDetail,
  ]);

  // Filter items based on query
  const filteredItems = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return items;
    return items.filter(
      (item) =>
        item.title.toLowerCase().includes(q) ||
        item.subtitle?.toLowerCase().includes(q) ||
        item.category.toLowerCase().includes(q)
    );
  }, [items, query]);

  // Reset selected index when query changes
  useEffect(() => {
    setSelectedIndex(0);
  }, [query]);

  // Handle keyboard navigation
  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setSelectedIndex((prev) => (prev + 1) % (filteredItems.length || 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setSelectedIndex((prev) => (prev - 1 + filteredItems.length) % (filteredItems.length || 1));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (filteredItems[selectedIndex]) {
        filteredItems[selectedIndex].action();
      }
    }
  };

  // Group filtered items by category
  const groupedItems = useMemo(() => {
    const groups: Record<string, PaletteItem[]> = {};
    filteredItems.forEach((item) => {
      if (!groups[item.category]) {
        groups[item.category] = [];
      }
      groups[item.category].push(item);
    });
    return groups;
  }, [filteredItems]);

  let flatIndex = 0;

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="p-0 overflow-hidden sm:max-w-xl max-h-[85vh] flex flex-col bg-white dark:bg-[#181922] border-slate-200 dark:border-[#2d2f3d] shadow-2xl rounded-2xl">
        <DialogTitle className="sr-only">Command Palette and Quick Search</DialogTitle>

        {/* Search Header */}
        <div className="p-3 border-b border-slate-200 dark:border-[#2b2d3c] flex items-center gap-2.5 bg-slate-50/70 dark:bg-[#14151e]">
          <Search className="w-4 h-4 text-purple-600 dark:text-purple-400 shrink-0 ml-1" />
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Type a command, page, workspace, or ticket #..."
            className="flex-1 bg-transparent text-sm font-medium text-slate-900 dark:text-slate-100 placeholder:text-slate-400 focus:outline-none"
          />
          {query && (
            <button
              type="button"
              onClick={() => setQuery('')}
              className="p-1 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 rounded"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          )}
          <kbd className="hidden sm:inline-block text-[10px] font-mono px-1.5 py-0.5 rounded bg-slate-200 dark:bg-[#2b2d3c] text-slate-600 dark:text-slate-400 border border-slate-300 dark:border-[#3d4052]">
            ESC
          </kbd>
        </div>

        {/* Results List */}
        <div className="flex-1 overflow-y-auto p-2 space-y-3 max-h-[420px]">
          {filteredItems.length === 0 ? (
            <div className="py-10 text-center text-xs text-slate-400">
              No results found for &ldquo;{query}&rdquo;
            </div>
          ) : (
            Object.entries(groupedItems).map(([category, catItems]) => (
              <div key={category} className="space-y-1">
                <div className="text-[10px] font-bold uppercase tracking-wider text-slate-400 dark:text-slate-500 px-2 py-0.5">
                  {category}
                </div>
                {catItems.map((item) => {
                  const currentIndex = flatIndex++;
                  const isSelected = currentIndex === selectedIndex;
                  const Icon = item.icon;

                  return (
                    <button
                      key={item.id}
                      type="button"
                      onClick={item.action}
                      onMouseEnter={() => setSelectedIndex(currentIndex)}
                      className={`w-full flex items-center justify-between px-2.5 py-2 rounded-lg text-left transition-all cursor-pointer ${
                        isSelected
                          ? 'bg-purple-100 dark:bg-purple-950/70 text-purple-900 dark:text-purple-200 font-medium'
                          : 'text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-[#20222f]'
                      }`}
                    >
                      <div className="flex items-center gap-2.5 min-w-0">
                        <div
                          className={`p-1.5 rounded-md shrink-0 ${
                            isSelected
                              ? 'bg-purple-200 dark:bg-purple-900/60 text-[#7b68ee]'
                              : 'bg-slate-100 dark:bg-[#252735] text-slate-500 dark:text-slate-400'
                          }`}
                        >
                          <Icon className="w-3.5 h-3.5" />
                        </div>
                        <div className="min-w-0">
                          <div className="text-xs font-semibold truncate flex items-center gap-1.5">
                            <span>{item.title}</span>
                            {item.badge && (
                              <span
                                className={`text-[9px] font-mono px-1.5 py-0.2 rounded font-semibold ${
                                  isSelected
                                    ? 'bg-purple-200 text-purple-800 dark:bg-purple-900 dark:text-purple-200'
                                    : 'bg-slate-200 dark:bg-slate-800 text-slate-500 dark:text-slate-400'
                                }`}
                              >
                                {item.badge}
                              </span>
                            )}
                          </div>
                          {item.subtitle && (
                            <div className="text-[11px] text-slate-400 dark:text-slate-500 truncate">
                              {item.subtitle}
                            </div>
                          )}
                        </div>
                      </div>

                      <ArrowRight
                        className={`w-3.5 h-3.5 shrink-0 transition-opacity ${
                          isSelected ? 'opacity-100 text-[#7b68ee]' : 'opacity-0'
                        }`}
                      />
                    </button>
                  );
                })}
              </div>
            ))
          )}
        </div>

        {/* Footer shortcuts hint */}
        <div className="p-2.5 px-4 bg-slate-50 dark:bg-[#14151e] border-t border-slate-200 dark:border-[#2b2d3c] flex items-center justify-between text-[11px] text-slate-400 dark:text-slate-500">
          <div className="flex items-center gap-3">
            <span className="flex items-center gap-1">
              <kbd className="font-mono text-[10px] px-1 py-0.5 rounded bg-slate-200 dark:bg-[#252735]">↑</kbd>
              <kbd className="font-mono text-[10px] px-1 py-0.5 rounded bg-slate-200 dark:bg-[#252735]">↓</kbd>
              <span>to navigate</span>
            </span>
            <span className="flex items-center gap-1">
              <kbd className="font-mono text-[10px] px-1.5 py-0.5 rounded bg-slate-200 dark:bg-[#252735]">↵</kbd>
              <span>to select</span>
            </span>
          </div>
          <span className="flex items-center gap-1">
            <kbd className="font-mono text-[10px] px-1.5 py-0.5 rounded bg-slate-200 dark:bg-[#252735]">ESC</kbd>
            <span>to close</span>
          </span>
        </div>
      </DialogContent>
    </Dialog>
  );
}
