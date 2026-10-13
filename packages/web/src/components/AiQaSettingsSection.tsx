import { useEffect, useState, type ReactNode } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Save, ShieldCheck } from 'lucide-react';
import type { AiQaSettings } from '@sp-kickstack/shared';
import { fetchAiQaSettings, saveAiQaSettings } from '../lib/aiQaApi.js';
import { fetchLocalEngineStatus } from '../lib/localEngineApi.js';
import { AGENT_CLI_CHOICES } from '../lib/localEngineText.js';
import { aiQaDraftProblem, qaCliStatus } from '../lib/aiQa.js';
import { AgentProfileFields } from './AgentProfilePicker.js';

const input =
  'w-full rounded-lg border border-slate-200 dark:border-[#2e303d] bg-white dark:bg-[#1a1b23] px-2.5 py-1.5 text-xs text-slate-800 dark:text-slate-200';
const fieldLabel = 'block text-[11px] font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400 mb-1';
const badge = (good: boolean) =>
  `px-1.5 py-0.5 rounded text-[10px] font-bold ${good ? 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400' : 'bg-amber-500/10 text-amber-600 dark:text-amber-400'}`;
/** For AI QA, "default" is the Local AI CLI engine's CLI. */
const CLI_CHOICES = AGENT_CLI_CHOICES.map((c) => (c.value === 'default' ? { ...c, label: "Local engine's CLI" } : c));

function Card({ children }: { children: ReactNode }) {
  return (
    <div className="bg-white dark:bg-[#242424] border border-slate-200 dark:border-[#2d2d2d] rounded-2xl p-6 shadow-sm space-y-4 animate-in fade-in-50 duration-150">
      <div className="flex items-center gap-2 pb-3 border-b border-slate-100 dark:border-[#2d2d2d]">
        <ShieldCheck className="w-5 h-5 text-[#7b68ee]" />
        <div>
          <h2 className="text-sm font-black uppercase tracking-wider text-slate-900 dark:text-white">AI QA</h2>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
            Checks each repository's merged code when a requirement enters QA: acceptance criteria, code review, test / build / lint. Findings
            become review comments; you decide what to send back.
          </p>
        </div>
      </div>
      {children}
    </div>
  );
}

/** Settings → AI & Local Engines → AI QA: the agent that checks a requirement's merged code in QA. */
export function AiQaSettingsSection() {
  const queryClient = useQueryClient();
  const { data, isError } = useQuery({ queryKey: ['ai-qa-settings'], queryFn: fetchAiQaSettings });
  const { data: status } = useQuery({ queryKey: ['local-engine-status'], queryFn: fetchLocalEngineStatus, refetchInterval: 3000 });
  const [draft, setDraft] = useState<AiQaSettings | null>(null);
  useEffect(() => {
    if (data) setDraft(data);
  }, [data]);

  const save = useMutation({
    mutationFn: (settings: AiQaSettings) => saveAiQaSettings(settings),
    onSuccess: (saved) => {
      queryClient.setQueryData(['ai-qa-settings'], saved);
      setDraft(saved);
      toast.success('AI QA settings saved');
    },
    onError: (err: Error) => toast.error(err.message),
  });

  if (!draft) {
    return (
      <Card>
        {isError ? (
          <p className="text-xs text-rose-600 dark:text-rose-400">Could not load the AI QA settings. Check that the server is running, then reload this page.</p>
        ) : (
          <p className="text-xs text-slate-500">Loading…</p>
        )}
      </Card>
    );
  }
  const problem = aiQaDraftProblem(draft);
  const dirty = JSON.stringify(draft) !== JSON.stringify(data);
  const set = (patch: Partial<AiQaSettings>) => setDraft({ ...draft, ...patch });
  const cli = qaCliStatus(draft.agentCli, status);

  return (
    <Card>
      <div className="space-y-5">
        <div className="flex items-center justify-between gap-3">
          <div>
            <p className="text-xs font-semibold text-slate-800 dark:text-slate-200">Run automatically when a requirement enters QA</p>
            <p className="text-[11px] text-slate-500 dark:text-slate-400">Off: AI QA runs only when you click Run AI QA in the requirement header.</p>
          </div>
          <button
            type="button"
            role="switch"
            aria-checked={draft.runAutomatically}
            aria-label="Run AI QA automatically when a requirement enters QA"
            onClick={() => set({ runAutomatically: !draft.runAutomatically })}
            className={`relative h-5 w-9 shrink-0 rounded-full transition-colors ${draft.runAutomatically ? 'bg-[#7b68ee]' : 'bg-slate-300 dark:bg-[#3a3a3a]'}`}
          >
            <span className={`absolute top-0.5 h-4 w-4 rounded-full bg-white transition-all ${draft.runAutomatically ? 'left-[18px]' : 'left-0.5'}`} />
          </button>
        </div>

        <div>
          <span className={fieldLabel} id="ai-qa-cli">CLI</span>
          <div role="radiogroup" aria-labelledby="ai-qa-cli" className="flex flex-wrap gap-1.5">
            {CLI_CHOICES.map((choice) => (
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

        <div>
          <span className={fieldLabel}>Model and effort</span>
          <AgentProfileFields
            value={{ model: draft.model, effort: draft.effort }}
            onChange={(v) => set({ model: v.model, effort: v.effort })}
            defaultChipLabel="Engine default"
            defaultTitle="Use the Local AI CLI engine's model and effort"
          />
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <label className="block">
            <span className={fieldLabel}>Time limit per QA run (minutes)</span>
            <input type="number" min={5} max={240} className={input} value={draft.timeLimitMinutes} onChange={(e) => set({ timeLimitMinutes: Number(e.target.value) })} />
          </label>
          <label className="block">
            <span className={fieldLabel}>Maximum findings per QA run</span>
            <input type="number" min={1} max={200} className={input} value={draft.maxFindings} onChange={(e) => set({ maxFindings: Number(e.target.value) })} />
          </label>
        </div>

        {cli && (
          <p className="flex items-center gap-2 text-xs">
            <span className={badge(cli.good)}>{cli.good ? 'READY' : 'CHECK'}</span>
            <span className="text-slate-700 dark:text-slate-300">{cli.text}</span>
          </p>
        )}

        <p className="text-[11px] text-slate-500 dark:text-slate-400">
          Each repository is checked in a temporary copy of the merged commit, which is deleted afterwards; AI QA never commits, pushes or changes
          a branch. QA runs share the Local AI CLI engine's parallel limit and usage-limit pauses. Set Build and Lint commands on the Projects page.
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
            <span>{save.isPending ? 'Saving...' : 'Save AI QA'}</span>
          </button>
        </div>
      </div>
    </Card>
  );
}
