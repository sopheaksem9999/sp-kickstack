import { useEffect, useState, type ReactNode } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import type { BranchMergePolicy, Requirement } from '@sp-kickstack/shared';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from './ui/dialog.js';
import { cn } from './ui/sheet.js';
import { AgentProfileFields } from './AgentProfilePicker.js';
import { BranchPicker } from './BranchPicker.js';
import { fetchProjects, startRequirementFanOut, updateRequirementProjects } from '../lib/api.js';
import { fetchBranches, saveRunSettings } from '../lib/runSettingsApi.js';
import { CLI_CHOICES, draftFromRequirement, modelSuggestionsFor, runSettingsPatch, runSettingsProblem, type RunSettingsDraft } from '../lib/runSettings.js';

export interface RunSettingsDialogProps {
  req: Requirement;
  /** 'fan-out': also repositories, and Start Fan-Out confirms. */
  mode: 'edit' | 'fan-out';
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

const MERGE_CHOICES: Array<{ value: BranchMergePolicy | null; label: string }> = [
  { value: null, label: 'Default' },
  { value: 'manual_review_merge', label: 'Review first' },
  { value: 'auto_merge', label: 'Auto-merge' },
];
const heading = 'text-[10px] font-bold uppercase tracking-wider text-slate-400';

function Choice({ pressed, role, onClick, children }: { pressed: boolean; role: 'radio' | 'checkbox'; onClick: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      role={role}
      aria-checked={pressed}
      onClick={onClick}
      className={cn(
        'px-2.5 py-1 rounded-lg text-[11px] font-semibold border transition-colors',
        pressed ? 'bg-[#7b68ee] border-[#7b68ee] text-white' : 'border-slate-200 dark:border-[#2e303d] text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-[#262732]'
      )}
    >
      {children}
    </button>
  );
}

const sameSet = (a: string[], b: string[]) => [...a].sort().join(',') === [...b].sort().join(',');

/** How a requirement's agents run; in fan-out mode the confirmation before agents start. */
export function RunSettingsDialog({ req, mode, open, onOpenChange }: RunSettingsDialogProps) {
  const queryClient = useQueryClient();
  const [draft, setDraft] = useState<RunSettingsDraft>(() => draftFromRequirement(req));
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (open) {
      setDraft(draftFromRequirement(req));
      setError(null);
    }
  }, [open, req]);

  const workspaceId = req.workspace_id || 'default';
  const { data: projects = [] } = useQuery({ queryKey: ['projects', workspaceId], queryFn: () => fetchProjects(workspaceId), enabled: open });
  const { data: branches = [] } = useQuery({
    queryKey: ['branches', [...draft.affected_projects].sort().join(',')],
    queryFn: () => fetchBranches(draft.affected_projects),
    enabled: open && draft.affected_projects.length > 0,
  });
  const enabledProjects = projects.filter((p) => p.enabled);
  const started = req.status !== 'draft' && req.status !== 'ready';
  const problem = runSettingsProblem(draft, mode);
  const set = (patch: Partial<RunSettingsDraft>) => setDraft((d) => ({ ...d, ...patch }));
  const toggleProject = (name: string) =>
    set({
      affected_projects: draft.affected_projects.includes(name) ? draft.affected_projects.filter((p) => p !== name) : [...draft.affected_projects, name],
    });

  const submit = useMutation({
    mutationFn: async () => {
      if (mode === 'fan-out' && !sameSet(draft.affected_projects, req.affected_projects)) {
        await updateRequirementProjects(req.id, draft.affected_projects);
      }
      const patch = runSettingsPatch(draft, req);
      if (Object.keys(patch).length > 0) await saveRunSettings(req.id, patch);
      if (mode === 'fan-out') await startRequirementFanOut(req.id);
    },
    onSuccess: () => {
      queryClient.invalidateQueries();
      toast.success(mode === 'fan-out' ? `Fan-out started for ${req.id}` : 'Run settings saved; they apply to runs started from now on');
      onOpenChange(false);
    },
    onError: (err: Error) => setError(err.message),
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{mode === 'fan-out' ? `Start fan-out: ${req.id}` : `Run settings: ${req.id}`}</DialogTitle>
          <DialogDescription>
            {mode === 'fan-out' ? 'Check how the agents will run. Nothing starts until you confirm.' : 'Changes apply to agent runs started from now on.'}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-5 text-xs">
          {mode === 'fan-out' && (
            <section className="space-y-1.5">
              <h3 className={heading}>Repositories</h3>
              <div className="flex flex-wrap gap-1.5">
                {enabledProjects.map((p) => (
                  <Choice key={p.name} role="checkbox" pressed={draft.affected_projects.includes(p.name)} onClick={() => toggleProject(p.name)}>
                    {p.name}
                  </Choice>
                ))}
              </div>
              {enabledProjects
                .filter((p) => draft.affected_projects.includes(p.name) && p.engine_type === 'manual')
                .map((p) => (
                  <p key={p.name} className="text-amber-600 dark:text-amber-400">
                    {p.name} is Manual: nobody works on it until you switch it to Local AI CLI.
                  </p>
                ))}
            </section>
          )}

          <section className="space-y-1.5">
            <h3 className={heading}>CLI</h3>
            <div className="flex flex-wrap gap-1.5" role="radiogroup" aria-label="CLI">
              {CLI_CHOICES.map((c) => (
                <Choice key={c.label} role="radio" pressed={draft.agent_cli === c.value} onClick={() => set({ agent_cli: c.value })}>
                  {c.label}
                </Choice>
              ))}
            </div>
            <p className="text-slate-500">Applies to Local AI CLI repositories. Default: Settings → AI &amp; Local Engines.</p>
          </section>

          <AgentProfileFields
            value={{ model: draft.agent_model, effort: draft.agent_effort }}
            onChange={(v) => set({ agent_model: v.model, agent_effort: v.effort })}
            suggestions={modelSuggestionsFor(draft.agent_cli)}
            defaultTitle="The CLI's model and effort from Settings"
          />

          <section className="space-y-1.5">
            <h3 className={heading}>Target branch</h3>
            <BranchPicker value={draft.target_branch} onChange={(v) => set({ target_branch: v })} entries={branches} chosenProjects={draft.affected_projects} disabled={started} />
            <p className="text-slate-500">
              {started
                ? 'Tasks were already branched from it, so it cannot change after fan-out.'
                : "Tasks start from it and are merged into it. A new name is created from each repository's base branch at fan-out."}
            </p>
          </section>

          <section className="space-y-1.5">
            <h3 className={heading}>Merge policy</h3>
            <div className="flex flex-wrap gap-1.5" role="radiogroup" aria-label="Merge policy">
              {MERGE_CHOICES.map((m) => (
                <Choice key={m.label} role="radio" pressed={draft.merge_policy === m.value} onClick={() => set({ merge_policy: m.value })}>
                  {m.label}
                </Choice>
              ))}
            </div>
          </section>
        </div>

        {(error || problem) && <p className="text-xs text-rose-600 dark:text-rose-400">{error ?? problem}</p>}
        <div className="flex justify-end gap-2">
          <button type="button" onClick={() => onOpenChange(false)} className="px-3 py-1.5 rounded-lg text-xs font-semibold border border-slate-200 dark:border-[#2e303d]">
            Cancel
          </button>
          <button
            type="button"
            disabled={Boolean(problem) || submit.isPending}
            onClick={() => {
              setError(null);
              submit.mutate();
            }}
            className="px-4 py-1.5 rounded-lg text-xs font-bold text-white bg-gradient-to-r from-[#7b68ee] to-[#ec4899] disabled:opacity-50"
          >
            {submit.isPending ? 'Working…' : mode === 'fan-out' ? 'Start Fan-Out' : 'Save'}
          </button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
