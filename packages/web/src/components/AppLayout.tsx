import { ReactNode } from 'react';
import { Link, useLocation } from 'react-router-dom';
import {
  Layers,
  FolderGit2,
  Settings,
  PlusCircle,
  Bell,
} from 'lucide-react';
import { Toaster } from 'sonner';

export function AppLayout({ children }: { children: ReactNode }) {
  const location = useLocation();

  const navItems = [
    { label: 'Requirements', path: '/requirements', icon: Layers },
    { label: 'New Requirement', path: '/requirements/new', icon: PlusCircle },
    { label: 'Projects & Engines', path: '/projects', icon: FolderGit2 },
    { label: 'Settings', path: '/settings', icon: Settings },
  ];

  return (
    <div className="flex min-h-screen bg-[#090d16] text-slate-100 font-sans">
      <Toaster richColors position="bottom-right" theme="dark" />
      
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
        <header className="h-14 border-b border-slate-800 bg-[#0d1322]/60 backdrop-blur px-6 flex items-center justify-between">
          <div className="text-xs text-slate-400 font-mono">
            127.0.0.1:4100
          </div>

          <div className="flex items-center gap-4">
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
