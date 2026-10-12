import { ReactNode, useState, useEffect } from 'react';
import { Link, useLocation } from 'react-router-dom';
import {
  Layers,
  FolderGit2,
  Settings,
  BookOpen,
  Plus,
  Sun,
  Moon,
  Search,
  Paperclip,
  PanelLeftClose,
  PanelLeftOpen,
  BarChart3,
  Sparkles,
} from 'lucide-react';
import { Toaster } from 'sonner';
import { useQuery } from '@tanstack/react-query';
import { useWorkspace } from '../lib/WorkspaceContext.js';
import { useTheme } from '../lib/ThemeContext.js';
import { useCreateRequirement } from '../lib/CreateRequirementContext.js';
import { healthQueryOptions } from '../lib/useDemoMode.js';
import { CreateWorkspaceModal, WorkspaceRulesModal } from './WorkspaceModals.js';
import { CreateRequirementSheet } from './CreateRequirementSheet.js';
import { OpenQuestionsButton } from './OpenQuestionsButton.js';
import { NotificationBell } from './NotificationBell.js';
import { EngineQuickViewPopover } from './EngineQuickViewPopover.js';
import { WorkspaceSelect } from './WorkspaceSelect.js';
import { CommandPaletteModal } from './CommandPaletteModal.js';

export function AppLayout({ children }: { children: ReactNode }) {
  const location = useLocation();
  const { theme, toggleTheme } = useTheme();
  const { workspaces, activeWorkspaceId, setActiveWorkspaceId, activeWorkspace, wsPath } = useWorkspace();
  const { openSheet } = useCreateRequirement();
  const [isCreateWsOpen, setIsCreateWsOpen] = useState(false);
  const [isRulesOpen, setIsRulesOpen] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [isCommandPaletteOpen, setIsCommandPaletteOpen] = useState(false);

  // Global Cmd+K / Ctrl+K listener for Quick Search
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setIsCommandPaletteOpen((prev) => !prev);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  const { isError: isOffline } = useQuery(healthQueryOptions);

  const navItems = [
    { label: 'Requirements', path: '/requirements', icon: Layers, badge: 'Tasks' },
    { label: 'AI Architect Chat', path: '/chat', icon: Sparkles, badge: 'AI Hub' },
    { label: 'Attachments Hub', path: '/attachments', icon: Paperclip, badge: 'Files' },
    { label: 'Repositories', path: '/projects', icon: FolderGit2, badge: 'Git' },
    { label: 'Telemetry & Sprints', path: '/metrics', icon: BarChart3, badge: 'Stats' },
    { label: 'Settings', path: '/settings', icon: Settings },
  ];

  const currentSubpath = location.pathname.replace(/^\/w\/[^/]+/, '') || '/requirements';

  const isNavActive = (subpath: string) => {
    if (subpath === '/requirements') {
      return currentSubpath.startsWith('/requirements');
    }
    return currentSubpath === subpath || currentSubpath.startsWith(subpath + '/');
  };

  const getBreadcrumbLabel = () => {
    if (currentSubpath === '/requirements/new') return 'New Requirement';
    if (currentSubpath.startsWith('/requirements/')) return 'Requirement Detail';
    if (currentSubpath === '/requirements') return 'Requirements';
    if (currentSubpath === '/chat') return 'AI Architect Chat';
    if (currentSubpath === '/attachments') return 'Attachments & Assets';
    if (currentSubpath === '/projects') return 'Repositories';
    if (currentSubpath === '/metrics') return 'Telemetry & Sprints';
    if (currentSubpath === '/settings') return 'Settings';
    return 'Home';
  };

  return (
    <div className="flex h-screen overflow-hidden bg-[#f7f8fa] dark:bg-[#191919] text-slate-800 dark:text-slate-100 font-sans transition-colors duration-200">
      <Toaster richColors position="bottom-right" theme={theme} />

      <CreateWorkspaceModal
        isOpen={isCreateWsOpen}
        onClose={() => setIsCreateWsOpen(false)}
      />

      <WorkspaceRulesModal
        isOpen={isRulesOpen}
        onClose={() => setIsRulesOpen(false)}
      />

      <CreateRequirementSheet />

      <CommandPaletteModal
        isOpen={isCommandPaletteOpen}
        onClose={() => setIsCommandPaletteOpen(false)}
        onCreateWorkspace={() => setIsCreateWsOpen(true)}
      />

      {/* Sidebar */}
      <aside
        className={`${
          sidebarOpen ? 'w-56' : 'w-12'
        } border-r border-slate-200 dark:border-[#2d2d2d] bg-[#fbfcfd] dark:bg-[#1e1e1e] flex flex-col shrink-0 select-none transition-all duration-200 overflow-hidden h-full`}
      >
        {/* Workspace Brand Tile */}
        <div className="p-3 border-b border-slate-200 dark:border-[#2d2d2d] flex items-center justify-between min-h-[48px]">
          {sidebarOpen && (
            <div className="flex items-center gap-2 min-w-0">
              <img
                src="/favicon.png"
                alt="Logo"
                className="w-7 h-7 rounded-lg object-cover shadow-md shadow-purple-500/20 shrink-0"
              />
              <div className="leading-tight min-w-0">
                <div className="flex items-center gap-1.5 font-bold text-sm tracking-tight text-slate-900 dark:text-white">
                  <span>SP Kickstack</span>
                  <span className="text-[9px] uppercase px-1.5 py-0.2 rounded font-mono font-bold bg-purple-100 dark:bg-purple-950/80 text-purple-700 dark:text-purple-300">
                    v0.2
                  </span>
                </div>
                <p className="text-[11px] text-slate-500 dark:text-slate-400 font-medium">Studio AI Bridge</p>
              </div>
            </div>
          )}
          {!sidebarOpen && (
            <img
              src="/favicon.png"
              alt="Logo"
              className="w-7 h-7 rounded-lg object-cover shadow-md shadow-purple-500/20 mx-auto"
            />
          )}
          <button
            type="button"
            onClick={() => setSidebarOpen((v) => !v)}
            className={`p-1 rounded-md text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-[#2a2a2a] transition-colors shrink-0 ${!sidebarOpen ? 'hidden' : ''}`}
            title={sidebarOpen ? 'Collapse sidebar' : 'Expand sidebar'}
          >
            <PanelLeftClose className="w-3.5 h-3.5" />
          </button>
        </div>

        {/* Workspace Selector & Create (Upper Create Requirement) */}
        {sidebarOpen && (
          <div className="px-2.5 pt-2.5 pb-1 space-y-1">
            <div className="text-[10px] font-bold uppercase tracking-wider text-slate-400 dark:text-slate-500 px-1 flex items-center justify-between">
              <span>Workspace</span>
              <button
                type="button"
                onClick={() => setIsCreateWsOpen(true)}
                className="flex items-center gap-0.5 text-purple-600 dark:text-purple-400 hover:text-purple-700 dark:hover:text-purple-300 normal-case font-semibold text-[10px] hover:underline cursor-pointer"
                title="Create New Workspace"
              >
                <Plus className="w-3 h-3" />
                <span>New</span>
              </button>
            </div>
            <div className="flex items-center gap-1.5">
              <WorkspaceSelect
                value={activeWorkspaceId}
                onValueChange={setActiveWorkspaceId}
                workspaces={workspaces}
                onCreateNew={() => setIsCreateWsOpen(true)}
              />
              <button
                type="button"
                onClick={() => setIsCreateWsOpen(true)}
                className="p-1.5 bg-slate-100 dark:bg-[#262626] hover:bg-purple-50 dark:hover:bg-purple-950/60 text-slate-600 dark:text-slate-400 hover:text-purple-600 dark:hover:text-purple-300 rounded-lg border border-slate-200 dark:border-[#333333] hover:border-purple-300 dark:hover:border-purple-700/60 transition shrink-0 cursor-pointer"
                title="Create New Workspace"
                aria-label="Create New Workspace"
              >
                <Plus className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>
        )}

        {/* Quick Add Action Button (Opens Right Sheet) */}
        {sidebarOpen && (
          <div className="p-2.5 pt-1.5 pb-1">
            <button
              type="button"
              onClick={openSheet}
              className="w-full flex items-center justify-center gap-2 px-3 py-2 bg-gradient-to-r from-[#7b68ee] to-[#6c5ce7] hover:from-[#6c5ce7] hover:to-[#5f3dc4] text-white rounded-lg text-xs font-semibold shadow-md shadow-purple-600/20 transition-all active:scale-[0.98]"
            >
              <Plus className="w-3.5 h-3.5" />
              <span>New Requirement</span>
            </button>
          </div>
        )}

        {/* Collapsed: expand button */}
        {!sidebarOpen && (
          <div className="flex flex-col items-center gap-1 pt-2">
            <button
              type="button"
              onClick={() => setSidebarOpen(true)}
              className="p-2 rounded-md text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-[#2a2a2a] transition-colors"
              title="Expand sidebar"
            >
              <PanelLeftOpen className="w-3.5 h-3.5" />
            </button>
            <WorkspaceSelect
              value={activeWorkspaceId}
              onValueChange={setActiveWorkspaceId}
              workspaces={workspaces}
              onCreateNew={() => setIsCreateWsOpen(true)}
              compact
            />
            <button
              type="button"
              onClick={() => setIsCommandPaletteOpen(true)}
              className="p-2 rounded-md text-slate-400 hover:text-purple-600 dark:hover:text-purple-400 hover:bg-slate-100 dark:hover:bg-[#2a2a2a] transition-colors"
              title="Quick Search (⌘K)"
            >
              <Search className="w-4 h-4" />
            </button>
            {/* Icon-only nav when collapsed */}
            {navItems.map((item) => {
              const Icon = item.icon;
              const active = isNavActive(item.path);
              return (
                <Link
                  key={item.path}
                  to={wsPath(item.path)}
                  title={item.label}
                  className={`p-2 rounded-lg transition-all ${
                    active
                      ? 'bg-purple-100 dark:bg-purple-950/50 text-[#7b68ee]'
                      : 'text-slate-400 dark:text-slate-500 hover:text-slate-800 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-[#262626]'
                  }`}
                >
                  <Icon className="w-4 h-4" />
                </Link>
              );
            })}
          </div>
        )}

        {/* Expanded: Search + Spaces label */}
        {sidebarOpen && (
          <>
            {/* Search Input / Command Palette Trigger */}
            <div className="px-2.5 pt-1.5 pb-1">
              <button
                type="button"
                onClick={() => setIsCommandPaletteOpen(true)}
                className="w-full flex items-center justify-between px-2.5 py-1.5 rounded-lg bg-slate-100 hover:bg-slate-200/80 dark:bg-[#262626] dark:hover:bg-[#2e2e2e] border border-slate-200 hover:border-purple-300 dark:border-[#333333] dark:hover:border-purple-700/60 text-xs text-slate-500 hover:text-slate-800 dark:text-slate-400 dark:hover:text-slate-200 transition-all cursor-pointer group shadow-2xs"
                title="Search / Jump to... (⌘K)"
              >
                <div className="flex items-center gap-1.5 min-w-0">
                  <Search className="w-3.5 h-3.5 text-slate-400 group-hover:text-[#7b68ee] transition-colors shrink-0" />
                  <span className="truncate text-left font-medium">Search / Jump to...</span>
                </div>
                <kbd className="text-[10px] font-mono px-1 py-0.5 rounded bg-white dark:bg-[#1f1f1f] border border-slate-200 dark:border-[#383838] text-slate-500 dark:text-slate-400 shrink-0 group-hover:border-purple-300 dark:group-hover:border-purple-700/60 shadow-2xs">
                  ⌘K
                </kbd>
              </button>
            </div>

            {/* Spaces & Navigation */}
            <div className="px-2.5 pt-2.5">
              <div className="text-[10px] font-bold uppercase tracking-wider text-slate-400 dark:text-slate-500 px-2 mb-1">
                Spaces
              </div>
            </div>

            <nav className="p-2 space-y-0.5 flex-1 overflow-y-auto">
              {navItems.map((item) => {
                const Icon = item.icon;
                const active = isNavActive(item.path);
                return (
                  <Link
                    key={item.path}
                    to={wsPath(item.path)}
                    className={`flex items-center justify-between px-2 py-1.5 rounded-lg text-xs font-semibold transition-all ${
                      active
                        ? 'bg-purple-100 dark:bg-purple-950/50 text-[#7b68ee] dark:text-purple-300 font-bold border border-purple-200 dark:border-purple-800/40 shadow-sm'
                        : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-[#262626]'
                    }`}
                  >
                    <div className="flex items-center gap-2">
                      <Icon className={`w-4 h-4 ${active ? 'text-[#7b68ee]' : 'text-slate-400 dark:text-slate-500'}`} />
                      <span>{item.label}</span>
                    </div>
                    {item.badge && (
                      <span className={`text-[10px] px-1.5 py-0.5 rounded font-mono ${
                        active
                          ? 'bg-purple-200/60 dark:bg-purple-900/60 text-purple-700 dark:text-purple-200'
                          : 'bg-slate-200/60 dark:bg-slate-800/80 text-slate-500 dark:text-slate-400'
                      }`}>
                        {item.badge}
                      </span>
                    )}
                  </Link>
                );
              })}
            </nav>

            {/* Sidebar Footer */}
            <div className="p-2.5 border-t border-slate-200 dark:border-[#2d2d2d] bg-[#f8f9fb] dark:bg-[#171717] flex flex-col gap-1.5">
              {/* Active Bridge Status */}
              <div className="flex items-center justify-between text-xs">
                {isOffline ? (
                  <>
                    <span className="flex items-center gap-1.5 text-rose-500 dark:text-rose-400 font-medium">
                      <span className="w-2 h-2 rounded-full bg-rose-500"></span>
                      Bridge Offline
                    </span>
                    <span className="text-[10px] font-mono text-rose-500 bg-rose-100 dark:bg-rose-950/60 px-1 py-0.5 rounded">
                      :4100
                    </span>
                  </>
                ) : (
                  <>
                    <span className="flex items-center gap-1.5 text-slate-500 dark:text-slate-400 font-medium">
                      <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse"></span>
                      Bridge Engine Active
                    </span>
                    <span className="text-[10px] font-mono text-slate-400 dark:text-slate-500 bg-slate-200 dark:bg-slate-800 px-1 py-0.5 rounded">
                      WAL
                    </span>
                  </>
                )}
              </div>

              {/* Theme Switcher Toggle */}
              <div className="flex items-center justify-between pt-1.5 border-t border-slate-200/80 dark:border-[#2d2d2d]">
                <span className="text-xs text-slate-500 dark:text-slate-400 font-medium">Mode</span>
                <button
                  onClick={toggleTheme}
                  className="flex items-center gap-1.5 px-2 py-1 rounded-md text-xs font-medium bg-slate-200 dark:bg-[#262626] text-slate-700 dark:text-slate-300 hover:bg-slate-300 dark:hover:bg-[#333333] transition-colors"
                  title={`Switch to ${theme === 'dark' ? 'Light' : 'Dark'} mode`}
                >
                  {theme === 'dark' ? (
                    <>
                      <Sun className="w-3.5 h-3.5 text-amber-400" />
                      <span>Light</span>
                    </>
                  ) : (
                    <>
                      <Moon className="w-3.5 h-3.5 text-indigo-500" />
                      <span>Dark</span>
                    </>
                  )}
                </button>
              </div>
            </div>
          </>
        )}
      </aside>

      {/* Main Content Area */}
      <div className="flex-1 flex flex-col min-w-0 h-full overflow-hidden">
        {isOffline && (
          <div className="bg-amber-500/15 dark:bg-amber-950/40 border-b border-amber-300 dark:border-amber-800/50 px-6 py-2 text-xs text-amber-900 dark:text-amber-200 flex items-center justify-between shrink-0">
            <div className="flex items-center gap-2">
              <span className="w-2 h-2 rounded-full bg-amber-500 animate-pulse shrink-0" />
              <span>
                <strong>Backend Bridge is offline:</strong> Could not connect to API on <code>http://127.0.0.1:4100</code>.
              </span>
            </div>
            <span className="font-mono text-[11px] bg-amber-200/70 dark:bg-amber-900/60 border border-amber-300/80 dark:border-amber-700 px-2 py-0.5 rounded text-amber-950 dark:text-amber-100 font-semibold">
              Run: npm run dev
            </span>
          </div>
        )}

        {/* ClickUp App Header */}
        <header className="h-14 shrink-0 border-b border-slate-200 dark:border-[#2d2d2d] bg-white dark:bg-[#1e1e1e] px-6 flex items-center justify-between transition-colors duration-200 shadow-sm z-20">
          {/* Breadcrumb & Workspace Selector */}
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-2 text-xs text-slate-500 dark:text-slate-400 font-medium">
              <span className="hidden sm:inline">Spaces</span>
              <span className="hidden sm:inline text-slate-300 dark:text-slate-600">/</span>
              <span className="font-semibold text-slate-800 dark:text-slate-200">
                {getBreadcrumbLabel()}
              </span>
            </div>

            {activeWorkspace && (
              <>
                <div className="h-4 w-px bg-slate-200 dark:bg-slate-800 mx-1 hidden sm:block" />
                <button
                  onClick={() => setIsRulesOpen(true)}
                  className="flex items-center gap-1.5 px-2.5 py-1 bg-purple-50 dark:bg-purple-950/40 hover:bg-purple-100 dark:hover:bg-purple-900/50 text-[#7b68ee] dark:text-purple-300 rounded-lg text-xs font-semibold border border-purple-200 dark:border-purple-800/40 transition"
                  title="Workspace Shared Rules & Architecture Context"
                >
                  <BookOpen className="w-3.5 h-3.5" />
                  <span className="hidden lg:inline">Shared Rules & Context</span>
                  <span className="lg:hidden">Rules</span>
                </button>
              </>
            )}
          </div>

          {/* Right Header Utilities */}
          <div className="flex items-center gap-2.5">
            <OpenQuestionsButton />
            {/* Quick Engine & Rate Limit Status Indicator */}
            <EngineQuickViewPopover />

            {/* Dark / Light Toggle Icon button */}
            <button
              onClick={toggleTheme}
              className="p-1.5 rounded-lg text-slate-500 dark:text-slate-400 hover:text-slate-800 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-[#262626] transition-colors"
              title={`Switch to ${theme === 'dark' ? 'Light' : 'Dark'} mode`}
            >
              {theme === 'dark' ? (
                <Sun className="w-4 h-4 text-amber-400" />
              ) : (
                <Moon className="w-4 h-4 text-indigo-500" />
              )}
            </button>

            <NotificationBell />

            {/* ClickUp Avatar */}
            <div className="w-7 h-7 rounded-full bg-gradient-to-tr from-[#7b68ee] to-[#ff007f] flex items-center justify-center text-white font-bold text-xs shadow-sm">
              S
            </div>
          </div>
        </header>

        {/* Main Content View Container */}
        <main
          className={`flex-1 min-h-0 ${
            currentSubpath.startsWith('/settings')
              ? 'p-4 md:p-6 overflow-hidden flex flex-col'
              : currentSubpath.startsWith('/chat') || currentSubpath.startsWith('/projects')
              ? 'p-0 overflow-hidden flex flex-col'
              : 'p-4 overflow-y-auto'
          }`}
        >
          {children}
        </main>
      </div>
    </div>
  );
}
