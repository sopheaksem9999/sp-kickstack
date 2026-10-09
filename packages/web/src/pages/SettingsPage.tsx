import { useState, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useTheme } from '../lib/ThemeContext.js';
import { fetchSettings, updateBranchMergeSettings } from '../lib/api.js';
import { toast } from 'sonner';
import {
  Sun,
  Moon,
  Shield,
  Monitor,
  CheckCircle2,
  GitBranch,
  GitMerge,
  Save,
  Check,
} from 'lucide-react';
import { BranchMergePolicy } from '@sp-kickstack/shared';

export function SettingsPage() {
  const { theme, setTheme } = useTheme();
  const queryClient = useQueryClient();

  const { data: settingsData } = useQuery({
    queryKey: ['settings'],
    queryFn: fetchSettings,
  });

  const [defaultBranch, setDefaultBranch] = useState('develop');
  const [mergePolicy, setMergePolicy] = useState<BranchMergePolicy>('manual_review_merge');

  useEffect(() => {
    if (settingsData?.branch_merge) {
      setDefaultBranch(settingsData.branch_merge.default_base_branch || 'develop');
      setMergePolicy(settingsData.branch_merge.merge_policy || 'manual_review_merge');
    }
  }, [settingsData]);

  const updateMutation = useMutation({
    mutationFn: () =>
      updateBranchMergeSettings({
        default_base_branch: defaultBranch.trim() || 'develop',
        merge_policy: mergePolicy,
      }),
    onSuccess: () => {
      toast.success('Branch & merge rules saved');
      queryClient.invalidateQueries({ queryKey: ['settings'] });
    },
    onError: (err: any) => {
      toast.error(err.message || 'Failed to save settings');
    },
  });

  return (
    <div className="max-w-4xl mx-auto space-y-8">
      {/* ClickUp Header */}
      <div>
        <div className="flex items-center gap-2 text-xs font-semibold text-purple-600 dark:text-purple-400 uppercase tracking-wider">
          <span>Preferences & Control</span>
        </div>
        <h1 className="text-2xl font-black text-slate-900 dark:text-white tracking-tight">
          Bridge Settings & Branch Strategy
        </h1>
        <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
          Configure ClickUp styling, git branch rules, automated merge policies, and safety limits
        </p>
      </div>

      {/* Git Branch & Implementation Rule Config (New Feature) */}
      <div className="bg-white dark:bg-[#181922] border border-slate-200 dark:border-[#262732] rounded-2xl p-6 shadow-sm space-y-5">
        <div className="flex items-center justify-between pb-3 border-b border-slate-100 dark:border-[#242531]">
          <div className="flex items-center gap-2">
            <GitBranch className="w-4 h-4 text-[#7b68ee]" />
            <h2 className="text-xs font-black uppercase tracking-wider text-slate-900 dark:text-white">
              Git Branch & Merge Strategy Rule
            </h2>
          </div>
          <span className="text-[10px] font-mono px-2 py-0.5 rounded font-bold bg-purple-100 dark:bg-purple-950/60 text-purple-700 dark:text-purple-300">
            Rule Config
          </span>
        </div>

        <p className="text-xs text-slate-500 dark:text-slate-400">
          Set the default target branch for all multi-repo implementations and choose whether agents automatically merge into main or await human operator review.
        </p>

        {/* Default Target Branch */}
        <div className="space-y-1.5">
          <label className="text-xs font-bold uppercase tracking-wider text-slate-600 dark:text-slate-300">
            Default Implementation Base Branch
          </label>
          <div className="flex items-center gap-2 max-w-sm">
            <div className="relative flex-1">
              <span className="absolute left-3 top-2.5 text-slate-400 font-mono text-xs">🌿</span>
              <input
                type="text"
                value={defaultBranch}
                onChange={(e) => setDefaultBranch(e.target.value)}
                placeholder="develop"
                className="w-full pl-8 pr-3 py-2 rounded-lg border border-slate-200 dark:border-[#2a2b38] bg-slate-50 dark:bg-[#14151b] font-mono text-xs font-bold text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-[#7b68ee]"
              />
            </div>
            <span className="text-xs text-slate-400">Default: <code className="text-[#7b68ee]">develop</code></span>
          </div>
          <p className="text-[11px] text-slate-400">
            All feature fan-outs and agent runs will target this branch by default instead of production main.
          </p>
        </div>

        {/* Merge Policy Selector */}
        <div className="space-y-2 pt-1">
          <label className="text-xs font-bold uppercase tracking-wider text-slate-600 dark:text-slate-300">
            Merge into Main Policy
          </label>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {/* Manual Review Option */}
            <div
              onClick={() => setMergePolicy('manual_review_merge')}
              className={`p-4 rounded-xl border cursor-pointer transition-all flex items-start gap-3 ${
                mergePolicy === 'manual_review_merge'
                  ? 'bg-purple-50/70 dark:bg-purple-950/40 border-[#7b68ee] ring-2 ring-[#7b68ee]/30 shadow-sm'
                  : 'bg-slate-50 dark:bg-[#14151b] border-slate-200 dark:border-[#2a2b38] hover:border-slate-300'
              }`}
            >
              <div className="p-2 rounded-lg bg-purple-100 dark:bg-purple-900/60 text-[#7b68ee] mt-0.5">
                <GitMerge className="w-4 h-4" />
              </div>
              <div className="flex-1">
                <div className="flex items-center justify-between">
                  <h3 className="font-bold text-xs text-slate-900 dark:text-white">
                    Manual Review & Merge
                  </h3>
                  {mergePolicy === 'manual_review_merge' && (
                    <CheckCircle2 className="w-4 h-4 text-[#7b68ee]" />
                  )}
                </div>
                <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-1 leading-relaxed">
                  Agents implement on <code className="text-[#7b68ee]">develop</code>. Once QA is done, human reviewer inspects the work and clicks <strong>&quot;Review & Merge to Main&quot;</strong>.
                </p>
              </div>
            </div>

            {/* Auto Merge Option */}
            <div
              onClick={() => setMergePolicy('auto_merge_main')}
              className={`p-4 rounded-xl border cursor-pointer transition-all flex items-start gap-3 ${
                mergePolicy === 'auto_merge_main'
                  ? 'bg-purple-50/70 dark:bg-purple-950/40 border-[#7b68ee] ring-2 ring-[#7b68ee]/30 shadow-sm'
                  : 'bg-slate-50 dark:bg-[#14151b] border-slate-200 dark:border-[#2a2b38] hover:border-slate-300'
              }`}
            >
              <div className="p-2 rounded-lg bg-emerald-100 dark:bg-emerald-900/60 text-emerald-600 mt-0.5">
                <Check className="w-4 h-4" />
              </div>
              <div className="flex-1">
                <div className="flex items-center justify-between">
                  <h3 className="font-bold text-xs text-slate-900 dark:text-white">
                    Automatic Merge to Main
                  </h3>
                  {mergePolicy === 'auto_merge_main' && (
                    <CheckCircle2 className="w-4 h-4 text-emerald-500" />
                  )}
                </div>
                <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-1 leading-relaxed">
                  Automatically merges feature changes from <code className="text-[#7b68ee]">develop</code> into <code className="text-emerald-500">main</code> once all tasks finish and tests pass.
                </p>
              </div>
            </div>
          </div>
        </div>

        <div className="pt-2">
          <button
            type="button"
            onClick={() => updateMutation.mutate()}
            disabled={updateMutation.isPending}
            className="flex items-center gap-2 px-4 py-2 rounded-lg bg-[#7b68ee] hover:bg-[#6c5ce7] text-white text-xs font-bold shadow-md shadow-purple-500/20 active:scale-[0.98] transition-all disabled:opacity-50"
          >
            <Save className="w-3.5 h-3.5" />
            <span>{updateMutation.isPending ? 'Saving...' : 'Save Branch & Merge Rules'}</span>
          </button>
        </div>
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
