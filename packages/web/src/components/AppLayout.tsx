import { ReactNode, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import {
  Layers,
  FolderGit2,
  Settings,
  PlusCircle,
  Bell,
  Building2,
  BookOpen,
  Plus,
} from 'lucide-react';
import { Toaster } from 'sonner';
import { useWorkspace } from '../lib/WorkspaceContext.js';
import { CreateWorkspaceModal, WorkspaceRulesModal } from './WorkspaceModals.js';

export function AppLayout({ children }: { children: ReactNode }) {
  const location = useLocation();
  const { workspaces, activeWorkspaceId, setActiveWorkspaceId, activeWorkspace } = useWorkspace();
  const [isCreateWsOpen, setIsCreateWsOpen] = useState(false);
  const [isRulesOpen, setIsRulesOpen] = useState(false);

  const navItems = [
    { label: 'Requirements', path: '/requirements', icon: Layers },
    { label: 'New Requirement', path: '/requirements/new', icon: PlusCircle },
    { label: 'Projects & Engines', path: '/projects', icon: FolderGit2 },
    { label: 'Settings', path: '/settings', icon: Settings },
  ];

  return (
    <div className="flex min-h-screen bg-[#090d16] text-slate-100 font-sans">
      <Toaster richColors position="bottom-right" theme="dark" />
      
      <CreateWorkspaceModal
        isOpen={isCreateWsOpen}
        onClose={() => setIsCreateWsOpen(false)}
      />

      <WorkspaceRulesModal
        isOpen={isRulesOpen}
        onClose={() => setIsRulesOpen(false)}
      />

      {/* Sidebar */}
      <aside className="w-64 border-r border-slate-800 bg-[#0d1322] flex flex-col">
        <div className="p-4 border-b border-slate-800 flex items-center gap-3">
          <div className="w-8 h-8 rounded-lg bg-blue-600 flex items-center justify-center font-bold text-white shadow-lg shadow-blue-500/30">
            ⚡
          </div>
          <div>
            <h1 className="font-semibold text-sm tracking-wide text-white">SP Kickstack</h1>
            <p className="text-xs text-slate-400">DevFlow Bridge</p>
          </div>
        </div>

        <nav className="p-3 space-y-1 flex-1">
          {navItems.map((item) => {
            const Icon = item.icon;
            const active = location.pathname === item.path || (item.path !== '/' && location.pathname.startsWith(item.path) && item.path !== '/requirements/new');
            return (
              <Link
                key={item.path}
                to={item.path}
                className={`flex items-center gap-3 px-3 py-2 rounded-lg text-sm font-medium transition-colors ${
                  active
                    ? 'bg-blue-600/20 text-blue-400 border border-blue-500/30'
                    : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/50'
                }`}
              >
                <Icon className="w-4 h-4" />
                {item.label}
              </Link>
            );
          })}
        </nav>

        <div className="p-4 border-t border-slate-800/80 text-xs text-slate-500 flex items-center justify-between">
          <span className="flex items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse"></span>
            Bridge Active
          </span>
          <span className="font-mono text-[10px] bg-slate-800 px-1.5 py-0.5 rounded">v0.2.0</span>
        </div>
      </aside>

      {/* Main Content Area */}
      <div className="flex-1 flex flex-col">
        <header className="h-14 border-b border-slate-800 bg-[#0d1322]/80 backdrop-blur px-6 flex items-center justify-between">
          {/* Workspace Switcher */}
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-2 bg-slate-900/90 border border-slate-700/80 rounded-lg px-2.5 py-1 text-xs">
              <Building2 className="w-3.5 h-3.5 text-blue-400" />
              <span className="text-slate-400 font-medium">Workspace:</span>
              <select
                value={activeWorkspaceId}
                onChange={(e) => setActiveWorkspaceId(e.target.value)}
                className="bg-transparent text-slate-200 font-semibold focus:outline-none cursor-pointer pr-1"
              >
                <option value="all" className="bg-slate-900 text-slate-200">
                  🌐 All Workspaces
                </option>
                {workspaces.map((ws) => (
                  <option key={ws.id} value={ws.id} className="bg-slate-900 text-slate-200">
                    📁 {ws.name} ({ws.id})
                  </option>
                ))}
              </select>
            </div>

            <button
              onClick={() => setIsCreateWsOpen(true)}
              className="flex items-center gap-1 px-2.5 py-1 bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white rounded-lg text-xs font-medium border border-slate-700/60 transition"
              title="Create New Workspace"
            >
              <Plus className="w-3.5 h-3.5" />
              <span>New Workspace</span>
            </button>

            {activeWorkspace && (
              <button
                onClick={() => setIsRulesOpen(true)}
                className="flex items-center gap-1.5 px-2.5 py-1 bg-emerald-950/40 hover:bg-emerald-900/50 text-emerald-400 rounded-lg text-xs font-medium border border-emerald-800/50 transition"
                title="View and Edit Shared Rules & Architecture Context"
              >
                <BookOpen className="w-3.5 h-3.5" />
                <span>Shared Rules & Context</span>
              </button>
            )}
          </div>

          <div className="flex items-center gap-4">
            <div className="text-xs text-slate-500 font-mono hidden md:block">
              127.0.0.1:4100
            </div>
            <button
              title="Notifications"
              className="p-1.5 rounded-lg text-slate-400 hover:text-slate-200 hover:bg-slate-800 transition-colors relative"
            >
              <Bell className="w-4 h-4" />
              <span className="absolute top-1 right-1 w-1.5 h-1.5 bg-blue-500 rounded-full"></span>
            </button>
          </div>
        </header>

        <main className="flex-1 p-6 overflow-y-auto">
          {children}
        </main>
      </div>
    </div>
  );
}
