import React, { useRef, useState } from 'react';
import { useAppTabs } from '../lib/TabContext.js';
import { useWorkspace } from '../lib/WorkspaceContext.js';
import {
  Layers,
  ListTodo,
  Sparkles,
  Paperclip,
  FolderGit2,
  BarChart3,
  Settings,
  Code2,
  Terminal,
  Plus,
  X,
  Copy,
  ChevronRight,
  Maximize2,
  Globe,
} from 'lucide-react';
import {
  Popover,
  PopoverTrigger,
  PopoverContent,
} from './ui/popover.js';

function getTabIcon(icon?: string) {
  switch (icon) {
    case 'layers':
      return <Layers className="w-3.5 h-3.5 text-blue-400 shrink-0" />;
    case 'queue':
      return <ListTodo className="w-3.5 h-3.5 text-amber-400 shrink-0" />;
    case 'chat':
      return <Sparkles className="w-3.5 h-3.5 text-purple-400 shrink-0" />;
    case 'globe':
      return <Globe className="w-3.5 h-3.5 text-indigo-400 shrink-0" />;
    case 'paperclip':
      return <Paperclip className="w-3.5 h-3.5 text-slate-400 shrink-0" />;
    case 'folder':
    case 'git':
      return <FolderGit2 className="w-3.5 h-3.5 text-emerald-400 shrink-0" />;
    case 'code':
      return <Code2 className="w-3.5 h-3.5 text-cyan-400 shrink-0" />;
    case 'terminal':
      return <Terminal className="w-3.5 h-3.5 text-emerald-400 shrink-0" />;
    case 'chart':
      return <BarChart3 className="w-3.5 h-3.5 text-pink-400 shrink-0" />;
    case 'settings':
      return <Settings className="w-3.5 h-3.5 text-slate-400 shrink-0" />;
    default:
      return <Layers className="w-3.5 h-3.5 text-slate-400 shrink-0" />;
  }
}

export const TabBar: React.FC = () => {
  const {
    tabs,
    activeTabId,
    switchTab,
    closeTab,
    openTab,
    closeOtherTabs,
    closeTabsToRight,
    duplicateTab,
    isTabBarEnabled,
  } = useAppTabs();
  const { wsPath } = useWorkspace();
  const tabListRef = useRef<HTMLDivElement>(null);
  const [contextTabId, setContextTabId] = useState<string | null>(null);

  if (!isTabBarEnabled) return null;

  const handleNewTab = () => {
    openTab({
      path: wsPath('/requirements'),
      title: 'Requirements',
      icon: 'layers',
    });
    // Auto-scroll to end
    setTimeout(() => {
      if (tabListRef.current) {
        tabListRef.current.scrollLeft = tabListRef.current.scrollWidth;
      }
    }, 50);
  };

  return (
    <div className="h-9 shrink-0 bg-[#f0f2f5] dark:bg-[#161616] border-b border-slate-200 dark:border-[#2d2d2d] flex items-center justify-between px-2 select-none z-30 transition-colors">
      {/* Tabs Container */}
      <div
        ref={tabListRef}
        className="flex items-center gap-1 overflow-x-auto no-scrollbar py-0.5 flex-1 min-w-0"
      >
        {tabs.map((tab) => {
          const isActive = tab.id === activeTabId;

          return (
            <div
              key={tab.id}
              onClick={() => switchTab(tab.id)}
              onContextMenu={(e) => {
                e.preventDefault();
                setContextTabId(tab.id);
              }}
              title={`${tab.title}\n${tab.path}`}
              className={`group relative flex items-center gap-2 px-3 py-1 text-xs rounded-t-lg border-t border-x cursor-pointer transition-all max-w-[210px] min-w-[120px] shrink-0 ${
                isActive
                  ? 'bg-white dark:bg-[#1e1e1e] border-slate-200 dark:border-[#2d2d2d] text-slate-900 dark:text-white font-bold shadow-xs'
                  : 'bg-transparent border-transparent text-slate-500 dark:text-slate-400 hover:text-slate-800 dark:hover:text-slate-200 hover:bg-slate-200/60 dark:hover:bg-[#242424]'
              }`}
            >
              {/* Active Accent Top Indicator Bar */}
              {isActive && (
                <div className="absolute top-0 left-0 right-0 h-[2px] bg-gradient-to-r from-purple-500 to-indigo-500 rounded-t-lg" />
              )}

              {/* Icon */}
              {getTabIcon(tab.icon)}

              {/* Title */}
              <span className="truncate flex-1 text-[11px] font-medium tracking-tight">
                {tab.title}
              </span>

              {/* Close Button */}
              {tabs.length > 1 && (
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    closeTab(tab.id);
                  }}
                  className={`p-0.5 rounded hover:bg-slate-200 dark:hover:bg-[#333333] transition-colors text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 ${
                    isActive ? 'opacity-90' : 'opacity-0 group-hover:opacity-100'
                  }`}
                  title="Close tab (⌘W)"
                >
                  <X className="w-3 h-3" />
                </button>
              )}
            </div>
          );
        })}

        {/* Plus / New Tab Button */}
        <button
          type="button"
          onClick={handleNewTab}
          className="p-1 rounded-md text-slate-400 hover:text-slate-800 dark:hover:text-slate-200 hover:bg-slate-200/70 dark:hover:bg-[#282828] transition-colors shrink-0 ml-0.5"
          title="New Tab (⌘T)"
        >
          <Plus className="w-3.5 h-3.5" />
        </button>
      </div>

      {/* Right Controls: Tab Count & Context Menu Trigger */}
      <div className="flex items-center gap-1.5 shrink-0 pl-2">
        {tabs.length > 1 && (
          <span className="text-[10px] font-mono font-bold text-slate-400 dark:text-slate-500 hidden sm:inline">
            {tabs.length} tabs
          </span>
        )}

        <Popover
          open={Boolean(contextTabId)}
          onOpenChange={(open) => {
            if (!open) setContextTabId(null);
          }}
        >
          <PopoverTrigger asChild>
            <span className="w-0 h-0 opacity-0 overflow-hidden" />
          </PopoverTrigger>
          {contextTabId && (
            <PopoverContent align="start" className="w-48 p-1.5 bg-white dark:bg-[#1a1a1a] border-slate-200 dark:border-[#333333] shadow-xl text-xs">
              <div className="px-2 py-1 text-[10px] font-bold uppercase tracking-wider text-slate-400 border-b border-slate-100 dark:border-[#2d2d2d] mb-1">
                Tab Options
              </div>
              <button
                type="button"
                onClick={() => {
                  duplicateTab(contextTabId);
                  setContextTabId(null);
                }}
                className="w-full flex items-center gap-2 px-2.5 py-1.5 rounded hover:bg-slate-100 dark:hover:bg-[#262626] text-left transition"
              >
                <Copy className="w-3.5 h-3.5 text-purple-400" />
                <span>Duplicate Tab</span>
              </button>
              {tabs.length > 1 && (
                <>
                  <button
                    type="button"
                    onClick={() => {
                      closeOtherTabs(contextTabId);
                      setContextTabId(null);
                    }}
                    className="w-full flex items-center gap-2 px-2.5 py-1.5 rounded hover:bg-slate-100 dark:hover:bg-[#262626] text-left transition"
                  >
                    <Maximize2 className="w-3.5 h-3.5 text-blue-400" />
                    <span>Close Other Tabs</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      closeTabsToRight(contextTabId);
                      setContextTabId(null);
                    }}
                    className="w-full flex items-center gap-2 px-2.5 py-1.5 rounded hover:bg-slate-100 dark:hover:bg-[#262626] text-left transition"
                  >
                    <ChevronRight className="w-3.5 h-3.5 text-amber-400" />
                    <span>Close Tabs to the Right</span>
                  </button>
                  <div className="my-1 border-t border-slate-100 dark:border-[#2d2d2d]" />
                  <button
                    type="button"
                    onClick={() => {
                      closeTab(contextTabId);
                      setContextTabId(null);
                    }}
                    className="w-full flex items-center gap-2 px-2.5 py-1.5 rounded hover:bg-rose-50 dark:hover:bg-rose-950/60 text-rose-600 dark:text-rose-400 text-left transition"
                  >
                    <X className="w-3.5 h-3.5" />
                    <span>Close Tab</span>
                  </button>
                </>
              )}
            </PopoverContent>
          )}
        </Popover>
      </div>
    </div>
  );
};
