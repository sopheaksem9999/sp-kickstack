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
} from 'lucide-react';
import { Toaster } from 'sonner';
import { useWorkspace } from '../lib/WorkspaceContext.js';
import { useTheme } from '../lib/ThemeContext.js';
import { useCreateRequirement } from '../lib/CreateRequirementContext.js';
import { CreateWorkspaceModal, WorkspaceRulesModal } from './WorkspaceModals.js';
import { CreateRequirementSheet } from './CreateRequirementSheet.js';

export function AppLayout({ children }: { children: ReactNode }) {
  const location = useLocation();
  const { theme, toggleTheme } = useTheme();
  const { workspaces, activeWorkspaceId, setActiveWorkspaceId, activeWorkspace } = useWorkspace();
  const { openSheet } = useCreateRequirement();
  const [isCreateWsOpen, setIsCreateWsOpen] = useState(false);
  const [isRulesOpen, setIsRulesOpen] = useState(false);

  const navItems = [
    { label: 'Requirements', path: '/requirements', icon: Layers, badge: 'Tasks' },
    { label: 'Projects & Engines', path: '/projects', icon: FolderGit2, badge: 'Repos' },
    { label: 'Settings', path: '/settings', icon: Settings },
  ];

  const getBreadcrumbLabel = () => {
    if (location.pathname === '/requirements/new') return 'New Requirement';
    if (location.pathname.startsWith('/requirements/')) return 'Requirement Detail';
    if (location.pathname === '/requirements') return 'Requirements';
    if (location.pathname === '/projects') return 'Projects & Engines';
    if (location.pathname === '/settings') return 'Settings';
    return 'Home';
  };

  return (
    <div className="flex min-h-screen bg-[#f7f8fa] dark:bg-[#111217] text-slate-800 dark:text-slate-100 font-sans transition-colors duration-200">
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

      {/* ClickUp Sidebar */}
      <aside className="w-64 border-r border-slate-200 dark:border-[#262732] bg-[#fbfcfd] dark:bg-[#16171d] flex flex-col shrink-0 select-none transition-colors duration-200">
        {/* Workspace Brand Tile */}
        <div className="p-3.5 border-b border-slate-200 dark:border-[#262732] flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-gradient-to-tr from-[#7b68ee] via-[#ec4899] to-[#00d2d3] flex items-center justify-center font-black text-white shadow-md shadow-purple-500/20 text-sm">
              ⚡
            </div>
            <div className="leading-tight">
              <div className="flex items-center gap-1.5 font-bold text-sm tracking-tight text-slate-900 dark:text-white">
                <span>SP Kickstack</span>
                <span className="text-[9px] uppercase px-1.5 py-0.2 rounded font-mono font-bold bg-purple-100 dark:bg-purple-950/80 text-purple-700 dark:text-purple-300">
                  v0.2
                </span>
              </div>
              <p className="text-[11px] text-slate-500 dark:text-slate-400 font-medium">ClickUp Bridge</p>
            </div>
          </div>
        </div>

        {/* Quick Add Action Button (Opens Right Sheet) */}
        <div className="p-3 pb-1">
          <button
            type="button"
            onClick={openSheet}
            className="w-full flex items-center justify-center gap-2 px-3 py-2 bg-gradient-to-r from-[#7b68ee] to-[#6c5ce7] hover:from-[#6c5ce7] hover:to-[#5f3dc4] text-white rounded-lg text-xs font-semibold shadow-md shadow-purple-600/20 transition-all active:scale-[0.98]"
          >
            <Plus className="w-3.5 h-3.5" />
            <span>New Requirement</span>
          </button>
        </div>

        {/* Search Mockup */}
        <div className="px-3 pt-2 pb-1">
          <div className="flex items-center justify-between px-2.5 py-1.5 rounded-md bg-slate-100 dark:bg-[#20212b] border border-slate-200 dark:border-[#2e303d] text-xs text-slate-400 dark:text-slate-500">
            <div className="flex items-center gap-1.5">
              <Search className="w-3.5 h-3.5" />
              <span>Search / Jump to...</span>
            </div>
            <kbd className="text-[10px] font-mono px-1 py-0.5 rounded bg-slate-200 dark:bg-[#2b2c3a] text-slate-500 dark:text-slate-400">
              ⌘K
            </kbd>
          </div>
        </div>

        {/* Spaces & Navigation */}
        <div className="px-3 pt-3">
          <div className="text-[10px] font-bold uppercase tracking-wider text-slate-400 dark:text-slate-500 px-2 mb-1.5">
            Spaces
          </div>
        </div>

        <nav className="p-2 space-y-1 flex-1 overflow-y-auto">
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
                className={`flex items-center justify-between px-2.5 py-2 rounded-lg text-xs font-semibold transition-all ${
                  active
                    ? 'bg-purple-100 dark:bg-purple-950/50 text-[#7b68ee] dark:text-purple-300 font-bold border border-purple-200 dark:border-purple-800/40 shadow-sm'
                    : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-[#20212c]'
                }`}
              >
                <div className="flex items-center gap-2.5">
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
        <div className="p-3 border-t border-slate-200 dark:border-[#262732] bg-[#f8f9fb] dark:bg-[#13141a] flex flex-col gap-2">
          {/* Active Bridge Status */}
          <div className="flex items-center justify-between text-xs">
            <span className="flex items-center gap-1.5 text-slate-500 dark:text-slate-400 font-medium">
              <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse"></span>
              Bridge Engine Active
            </span>
            <span className="text-[10px] font-mono text-slate-400 dark:text-slate-500 bg-slate-200 dark:bg-slate-800 px-1 py-0.5 rounded">
              WAL
            </span>
          </div>

          {/* Theme Switcher Toggle */}
          <div className="flex items-center justify-between pt-2 border-t border-slate-200/80 dark:border-[#242531]">
            <span className="text-xs text-slate-500 dark:text-slate-400 font-medium">Mode</span>
            <button
              onClick={toggleTheme}
              className="flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-medium bg-slate-200 dark:bg-[#242531] text-slate-700 dark:text-slate-300 hover:bg-slate-300 dark:hover:bg-[#2e303d] transition-colors"
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
      </aside>

      {/* Main Content Area */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* ClickUp App Header */}
        <header className="h-14 border-b border-slate-200 dark:border-[#262732] bg-white dark:bg-[#16171d] px-6 flex items-center justify-between sticky top-0 z-20 transition-colors duration-200 shadow-sm">
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
            <div className="flex items-center gap-1.5 bg-slate-100 dark:bg-[#20212c] border border-slate-200 dark:border-[#2e303d] rounded-lg px-2.5 py-1 text-xs">
              <Building2 className="w-3.5 h-3.5 text-[#7b68ee]" />
              <select
                value={activeWorkspaceId}
                onChange={(e) => setActiveWorkspaceId(e.target.value)}
                className="bg-transparent text-slate-800 dark:text-slate-200 font-semibold focus:outline-none cursor-pointer pr-1"
              >
                <option value="all" className="bg-white dark:bg-[#1c1d27] text-slate-800 dark:text-slate-200">
                  🌐 All Workspaces
                </option>
                {workspaces.map((ws) => (
                  <option key={ws.id} value={ws.id} className="bg-white dark:bg-[#1c1d27] text-slate-800 dark:text-slate-200">
                    📁 {ws.name} ({ws.id})
                  </option>
                ))}
              </select>
            </div>

            <button
              onClick={() => setIsCreateWsOpen(true)}
              className="flex items-center gap-1 px-2 py-1 bg-slate-100 dark:bg-[#20212c] hover:bg-slate-200 dark:hover:bg-[#2a2b38] text-slate-600 dark:text-slate-300 rounded-lg text-xs font-medium border border-slate-200 dark:border-[#2e303d] transition"
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
              className="p-1.5 rounded-lg text-slate-500 dark:text-slate-400 hover:text-slate-800 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-[#20212c] transition-colors"
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
              className="p-1.5 rounded-lg text-slate-500 dark:text-slate-400 hover:text-slate-800 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-[#20212c] transition-colors relative"
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
        <main className="flex-1 p-6 overflow-y-auto">
          {children}
        </main>
      </div>
    </div>
  );
}
