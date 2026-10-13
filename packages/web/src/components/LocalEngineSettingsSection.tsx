import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Save } from 'lucide-react';
import type { LocalEngineSettings } from '@sp-kickstack/shared';
import { fetchLocalEngineSettings, fetchLocalEngineStatus, saveLocalEngineSettings } from '../lib/localEngineApi.js';
import { AGENT_CLI_CHOICES, installBadge, limitBadge, localEngineDraftProblem, nextCliText, runCountsText } from '../lib/localEngineText.js';

const input =
  'w-full rounded-lg border border-slate-200 dark:border-[#2e303d] bg-white dark:bg-[#1a1b23] px-2.5 py-1.5 text-xs text-slate-800 dark:text-slate-200';
const fieldLabel = 'block text-[11px] font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400 mb-1';
const badge = (good: boolean) =>
  `px-1.5 py-0.5 rounded text-[10px] font-bold ${good ? 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400' : 'bg-amber-500/10 text-amber-600 dark:text-amber-400'}`;

/** Settings → AI & Local Engines: the engine that runs fan-out tasks with an AI CLI on this PC. */
export function LocalEngineSettingsSection() {
  const queryClient = useQueryClient();
  const { data, isError } = useQuery({ queryKey: ['local-engine-settings'], queryFn: fetchLocalEngineSettings });
  const { data: status } = useQuery({ queryKey: ['local-engine-status'], queryFn: fetchLocalEngineStatus, refetchInterval: 3000 });
  const [draft, setDraft] = useState<LocalEngineSettings | null>(null);
  useEffect(() => {
    if (data) setDraft(data);
  }, [data]);

  const save = useMutation({
    mutationFn: (settings: LocalEngineSettings) => saveLocalEngineSettings(settings),
    onSuccess: (saved) => {
      queryClient.setQueryData(['local-engine-settings'], saved);
      setDraft(saved);
      void queryClient.invalidateQueries({ queryKey: ['local-engine-status'] });
      toast.success('Local AI CLI engine settings saved');
    },
    onError: (err: Error) => toast.error(err.message),
  });

  if (!draft) {
    return isError ? (
      <p className="text-xs text-rose-600 dark:text-rose-400">Could not load the Local AI CLI engine settings. Check that the server is running, then reload this page.</p>
    ) : (
      <p className="text-xs text-slate-500">Loading…</p>
    );
  }
  const problem = localEngineDraftProblem(draft);
  const dirty = JSON.stringify(draft) !== JSON.stringify(data);
  const set = (patch: Partial<LocalEngineSettings>) => setDraft({ ...draft, ...patch });

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between gap-3">
        <div>
          <p className="text-xs font-semibold text-slate-800 dark:text-slate-200">Run agents on this PC</p>
          <p className="text-[11px] text-slate-500 dark:text-slate-400">Repositories with the Local AI CLI engine start their tasks by themselves after Start Fan-Out.</p>
        </div>
        <button
          type="button"
          role="switch"
          aria-checked={draft.enabled}
          aria-label="Run agents on this PC"
          onClick={() => set({ enabled: !draft.enabled })}
          className={`relative h-5 w-9 shrink-0 rounded-full transition-colors ${draft.enabled ? 'bg-[#7b68ee]' : 'bg-slate-300 dark:bg-[#3a3a3a]'}`}
        >
          <span className={`absolute top-0.5 h-4 w-4 rounded-full bg-white transition-all ${draft.enabled ? 'left-[18px]' : 'left-0.5'}`} />
        </button>
      </div>

      <div>
        <span className={fieldLabel} id="local-engine-cli">Agent CLI</span>
        <div role="radiogroup" aria-labelledby="local-engine-cli" className="flex flex-wrap gap-1.5">
          {AGENT_CLI_CHOICES.map((choice) => (
            <button
              key={choice.value}
              type="button"
              role="radio"
              aria-checked={draft.agentCli === choice.value}
              onClick={() => set({ agentCli: choice.value })}
              className={`px-3 py-1.5 rounded-lg text-xs font-semibold border ${
                draft.agentCli === choice.value
                  ? 'border-[#7b68ee] bg-[#7b68ee]/10 text-[#7b68ee]'
                  : 'border-slate-200 dark:border-[#2e303d] text-slate-600 dark:text-slate-300'
              }`}
            >
              {choice.label}
            </button>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <label className="block">
          <span className={fieldLabel}>Parallel agents (1–8)</span>
          <input type="number" min={1} max={8} className={input} value={draft.maxParallel} onChange={(e) => set({ maxParallel: Number(e.target.value) })} />
        </label>
        <label className="block">
          <span className={fieldLabel}>Time limit per run (minutes)</span>
          <input type="number" min={5} max={480} className={input} value={draft.runTimeoutMinutes} onChange={(e) => set({ runTimeoutMinutes: Number(e.target.value) })} />
        </label>
        <label className="block">
          <span className={fieldLabel}>Worktree folder</span>
          <input className={input} placeholder={status?.worktreeRoot ?? 'agent-worktrees in the server workspace'} value={draft.worktreeRoot} onChange={(e) => set({ worktreeRoot: e.target.value })} />
        </label>
      </div>

      {status && (
        <div className="rounded-xl border border-slate-200 dark:border-[#2e303d] p-3 space-y-2">
          <p className="text-xs font-semibold text-slate-800 dark:text-slate-200">{nextCliText(status)}</p>
          <p className="text-[11px] text-slate-500 dark:text-slate-400">{runCountsText(status.counts)}</p>
          <ul className="space-y-1">
            {status.clis.map((c) => {
              const limit = limitBadge(c);
              return (
                <li key={c.id} className="flex items-center justify-between text-xs">
                  <span className="text-slate-700 dark:text-slate-300">
                    {c.label}
                    {c.enabled ? '' : ' (turned off)'}
                  </span>
                  <span className="flex gap-1.5">
                    <span className={badge(c.installed)}>{installBadge(c)}</span>
                    <span className={badge(limit === 'HEALTHY')}>{limit}</span>
                  </span>
                </li>
              );
            })}
          </ul>
        </div>
      )}

      <p className="text-[11px] text-slate-500 dark:text-slate-400">
        Each task runs in its own git worktree on its task branch; your own checkout is never touched. The agent's commands run as your
        user account: Codex is limited to the worktree, while Claude Code and AGY are told to stay in it but are not blocked from leaving it.
      </p>

      <div className="flex items-center justify-end gap-3">
        {problem && <span className="text-xs text-rose-600 dark:text-rose-400">{problem}</span>}
        <button
          type="button"
          disabled={!dirty || Boolean(problem) || save.isPending}
          onClick={() => save.mutate(draft)}
          className="flex items-center gap-2 px-4 py-2 rounded-lg bg-[#7b68ee] hover:bg-[#6c5ce7] text-white text-xs font-bold shadow-md shadow-purple-500/20 disabled:opacity-50"
        >
          <Save className="w-3.5 h-3.5" />
          <span>{save.isPending ? 'Saving...' : 'Save Local Engine'}</span>
        </button>
      </div>
    </div>
  );
}
