import { useTheme } from '../lib/ThemeContext.js';
import { Sun, Moon, Shield, Monitor, CheckCircle2 } from 'lucide-react';

export function SettingsPage() {
  const { theme, setTheme } = useTheme();

  return (
    <div className="max-w-4xl mx-auto space-y-8">
      {/* ClickUp Header */}
      <div>
        <div className="flex items-center gap-2 text-xs font-semibold text-purple-600 dark:text-purple-400 uppercase tracking-wider">
          <span>Preferences & Control</span>
        </div>
        <h1 className="text-2xl font-black text-slate-900 dark:text-white tracking-tight">
          Bridge Settings & Theme
        </h1>
        <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
          Configure ClickUp styling, appearance themes, and multi-repo safety gates
        </p>
      </div>

      {/* Appearance & Themes Section */}
      <div className="bg-white dark:bg-[#181922] border border-slate-200 dark:border-[#262732] rounded-2xl p-6 shadow-sm space-y-4">
        <div className="flex items-center gap-2 pb-3 border-b border-slate-100 dark:border-[#242531]">
          <Monitor className="w-4 h-4 text-[#7b68ee]" />
          <h2 className="text-xs font-black uppercase tracking-wider text-slate-900 dark:text-white">
            Appearance & Color Theme
          </h2>
        </div>

        <p className="text-xs text-slate-500 dark:text-slate-400">
          Choose your preferred workspace display mode. Automatically synchronized across sessions.
        </p>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 pt-2">
          {/* Light Mode Option */}
          <div
            onClick={() => setTheme('light')}
            className={`p-4 rounded-xl border cursor-pointer transition-all flex items-start gap-3 ${
              theme === 'light'
                ? 'bg-purple-50/60 border-[#7b68ee] ring-2 ring-[#7b68ee]/30 shadow-sm'
                : 'bg-slate-50 dark:bg-[#14151b] border-slate-200 dark:border-[#2a2b38] hover:border-slate-300'
            }`}
          >
            <div className="p-2 rounded-lg bg-amber-100 text-amber-600 mt-0.5">
              <Sun className="w-5 h-5" />
            </div>
            <div className="flex-1">
              <div className="flex items-center justify-between">
                <h3 className="font-bold text-xs text-slate-900 dark:text-white">Light Mode</h3>
                {theme === 'light' && (
                  <CheckCircle2 className="w-4 h-4 text-[#7b68ee]" />
                )}
              </div>
              <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-1">
                Crisp, modern ClickUp clean white backgrounds with high readability.
              </p>
            </div>
          </div>

          {/* Dark Mode Option */}
          <div
            onClick={() => setTheme('dark')}
            className={`p-4 rounded-xl border cursor-pointer transition-all flex items-start gap-3 ${
              theme === 'dark'
                ? 'bg-purple-950/40 border-[#7b68ee] ring-2 ring-[#7b68ee]/30 shadow-sm'
                : 'bg-slate-50 dark:bg-[#14151b] border-slate-200 dark:border-[#2a2b38] hover:border-slate-300'
            }`}
          >
            <div className="p-2 rounded-lg bg-indigo-900/60 text-indigo-300 mt-0.5">
              <Moon className="w-5 h-5" />
            </div>
            <div className="flex-1">
              <div className="flex items-center justify-between">
                <h3 className="font-bold text-xs text-slate-900 dark:text-white">Dark Mode</h3>
                {theme === 'dark' && (
                  <CheckCircle2 className="w-4 h-4 text-[#7b68ee]" />
                )}
              </div>
              <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-1">
                Sleek deep dark palette engineered for focus and reduced eye strain.
              </p>
            </div>
          </div>
        </div>
      </div>

      {/* Safety & Execution Limits */}
      <div className="bg-white dark:bg-[#181922] border border-slate-200 dark:border-[#262732] rounded-2xl p-6 shadow-sm space-y-5">
        <div className="flex items-center gap-2 pb-3 border-b border-slate-100 dark:border-[#242531]">
          <Shield className="w-4 h-4 text-emerald-500" />
          <h2 className="text-xs font-black uppercase tracking-wider text-slate-900 dark:text-white">
            Safety & Fan-Out Execution Limits
          </h2>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-xs font-mono">
          <div className="p-4 rounded-xl bg-slate-50 dark:bg-[#14151b] border border-slate-200 dark:border-[#242531]">
            <span className="text-slate-400 dark:text-slate-500 text-[10px] uppercase font-bold block">
              MAX_DEPTH
            </span>
            <span className="text-slate-900 dark:text-white font-black text-xl">3</span>
            <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-1">
              Maximum allowed cross-repo ticket recursion depth
            </p>
          </div>

          <div className="p-4 rounded-xl bg-slate-50 dark:bg-[#14151b] border border-slate-200 dark:border-[#242531]">
            <span className="text-slate-400 dark:text-slate-500 text-[10px] uppercase font-bold block">
              MAX_TICKETS_PER_REQ
            </span>
            <span className="text-slate-900 dark:text-white font-black text-xl">10</span>
            <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-1">
              Maximum dependency tickets allowed per requirement
            </p>
          </div>

          <div className="p-4 rounded-xl bg-slate-50 dark:bg-[#14151b] border border-slate-200 dark:border-[#242531]">
            <span className="text-slate-400 dark:text-slate-500 text-[10px] uppercase font-bold block">
              WATCH_INTERVAL_MS
            </span>
            <span className="text-slate-900 dark:text-white font-black text-xl">5000 ms</span>
            <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-1">
              Engine poller synchronization polling frequency
            </p>
          </div>

          <div className="p-4 rounded-xl bg-slate-50 dark:bg-[#14151b] border border-slate-200 dark:border-[#242531]">
            <span className="text-slate-400 dark:text-slate-500 text-[10px] uppercase font-bold block">
              MAX_BODY_BYTES
            </span>
            <span className="text-slate-900 dark:text-white font-black text-xl">20 KB</span>
            <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-1">
              Maximum ticket payload size for xticket creation
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
