import { ReactNode, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import {
  Layers,
  FolderGit2,
  Settings,
  Bell,
  Building2,
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

export function AppLayout({ children }: { children: ReactNode }) {
  const location = useLocation();
  const { theme, toggleTheme } = useTheme();
  const { workspaces, activeWorkspaceId, setActiveWorkspaceId, activeWorkspace } = useWorkspace();
  const { openSheet } = useCreateRequirement();
  const [isCreateWsOpen, setIsCreateWsOpen] = useState(false);
  const [isRulesOpen, setIsRulesOpen] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(true);

  const { isError: isOffline } = useQuery(healthQueryOptions);

  const navItems = [
    { label: 'Requirements', path: '/requirements', icon: Layers, badge: 'Tasks' },
    { label: 'AI Architect Chat', path: '/chat', icon: Sparkles, badge: 'AI Hub' },
    { label: 'Attachments Hub', path: '/attachments', icon: Paperclip, badge: 'Files' },
    { label: 'Repositories', path: '/projects', icon: FolderGit2, badge: 'Git' },
    { label: 'Telemetry & Sprints', path: '/metrics', icon: BarChart3, badge: 'Stats' },
    { label: 'Settings', path: '/settings', icon: Settings },
  ];

  const getBreadcrumbLabel = () => {
    if (location.pathname === '/requirements/new') return 'New Requirement';
    if (location.pathname.startsWith('/requirements/')) return 'Requirement Detail';
    if (location.pathname === '/requirements') return 'Requirements';
    if (location.pathname === '/chat') return 'AI Architect Chat';
    if (location.pathname === '/attachments') return 'Attachments & Assets';
    if (location.pathname === '/projects') return 'Repositories';
    if (location.pathname === '/metrics') return 'Telemetry & Sprints';
    if (location.pathname === '/settings') return 'Settings';
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

        {/* Quick Add Action Button (Opens Right Sheet) */}
        {sidebarOpen && (
        <div className="p-2.5 pb-1">
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
            {/* Icon-only nav when collapsed */}
            {navItems.map((item) => {
              const Icon = item.icon;
              const active =
                location.pathname === item.path ||
                (item.path !== '/' &&
                  location.pathname.startsWith(item.path) &&
                  item.path !== '/requirements/new');
              return (
                <Link
                  key={item.path}
                  to={item.path}
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
            {/* Search Mockup */}
            <div className="px-2.5 pt-1.5 pb-1">
              <div className="flex items-center justify-between px-2 py-1.5 rounded-md bg-slate-100 dark:bg-[#262626] border border-slate-200 dark:border-[#333333] text-xs text-slate-400 dark:text-slate-500">
                <div className="flex items-center gap-1.5">
                  <Search className="w-3.5 h-3.5" />
                  <span>Search / Jump to...</span>
                </div>
                <kbd className="text-[10px] font-mono px-1 py-0.5 rounded bg-slate-200 dark:bg-[#333333] text-slate-500 dark:text-slate-400">
                  ⌘K
                </kbd>
              </div>
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
                const active =
                  location.pathname === item.path ||
                  (item.path !== '/' &&
                    location.pathname.startsWith(item.path) &&
                    item.path !== '/requirements/new');
                return (
                  <Link
                    key={item.path}
                    to={item.path}
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

            <div className="h-4 w-px bg-slate-200 dark:bg-slate-800 mx-1 hidden sm:block" />

            {/* Workspace Dropdown */}
            <div className="flex items-center gap-1.5 bg-slate-100 dark:bg-[#262626] border border-slate-200 dark:border-[#333333] rounded-lg px-2.5 py-1 text-xs">
              <Building2 className="w-3.5 h-3.5 text-[#7b68ee]" />
              <select
                value={activeWorkspaceId}
                onChange={(e) => setActiveWorkspaceId(e.target.value)}
                className="bg-transparent text-slate-800 dark:text-slate-200 font-semibold focus:outline-none cursor-pointer pr-1"
              >
                <option value="all" className="bg-white dark:bg-[#262626] text-slate-800 dark:text-slate-200">
                  🌐 All Workspaces
                </option>
                {workspaces.map((ws) => (
                  <option key={ws.id} value={ws.id} className="bg-white dark:bg-[#262626] text-slate-800 dark:text-slate-200">
                    📁 {ws.name} ({ws.id})
                  </option>
                ))}
                {activeWorkspaceId !== 'all' && !workspaces.some((ws) => ws.id === activeWorkspaceId) && (
                  <option value={activeWorkspaceId} className="bg-white dark:bg-[#262626] text-slate-800 dark:text-slate-200">
                    📁 {activeWorkspaceId}
                  </option>
                )}
              </select>
            </div>

            <button
              onClick={() => setIsCreateWsOpen(true)}
              className="flex items-center gap-1 px-2 py-1 bg-slate-100 dark:bg-[#262626] hover:bg-slate-200 dark:hover:bg-[#333333] text-slate-600 dark:text-slate-300 rounded-lg text-xs font-medium border border-slate-200 dark:border-[#333333] transition"
              title="Add New Workspace"
            >
              <Plus className="w-3.5 h-3.5" />
              <span className="hidden md:inline">Workspace</span>
            </button>

            {activeWorkspace && (
              <button
                onClick={() => setIsRulesOpen(true)}
                className="flex items-center gap-1.5 px-2.5 py-1 bg-purple-50 dark:bg-purple-950/40 hover:bg-purple-100 dark:hover:bg-purple-900/50 text-[#7b68ee] dark:text-purple-300 rounded-lg text-xs font-semibold border border-purple-200 dark:border-purple-800/40 transition"
                title="Workspace Shared Rules & Architecture Context"
              >
                <BookOpen className="w-3.5 h-3.5" />
                <span className="hidden lg:inline">Shared Rules & Context</span>
              </button>
            )}
          </div>

          {/* Right Header Utilities */}
          <div className="flex items-center gap-3">
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

            <button
              title="Notifications"
              className="p-1.5 rounded-lg text-slate-500 dark:text-slate-400 hover:text-slate-800 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-[#262626] transition-colors relative"
            >
              <Bell className="w-4 h-4" />
              <span className="absolute top-1 right-1 w-1.5 h-1.5 bg-[#ec4899] rounded-full"></span>
            </button>

            {/* ClickUp Avatar */}
            <div className="w-7 h-7 rounded-full bg-gradient-to-tr from-[#7b68ee] to-[#ff007f] flex items-center justify-center text-white font-bold text-xs shadow-sm">
              S
            </div>
          </div>
        </header>

        {/* Main Content View Container */}
        <main
          className={`flex-1 min-h-0 ${
            location.pathname.startsWith('/settings')
              ? 'p-4 md:p-6 overflow-hidden flex flex-col'
              : location.pathname.startsWith('/chat') || location.pathname.startsWith('/projects')
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
