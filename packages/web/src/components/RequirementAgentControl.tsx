import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import type { Requirement } from '@sp-kickstack/shared';
import { AgentProfilePicker } from './AgentProfilePicker.js';
import { updateRequirementAgentProfile } from '../lib/humanLoopApi.js';
import { useWorkspace } from '../lib/WorkspaceContext.js';
import { defaultProfileLabel } from '../lib/agentProfile.js';
import type { ProfileValue } from '../lib/agentProfile.js';

/** "Agent:" control in the requirement header: the model and effort for this requirement's runs. */
export function RequirementAgentControl({ req }: { req: Requirement }) {
  const queryClient = useQueryClient();
  const { workspaces } = useWorkspace();
  const workspace = workspaces.find((w) => w.id === req.workspace_id);
  const value: ProfileValue = { model: req.agent_model ?? null, effort: req.agent_effort ?? null };
  const key = ['requirement', req.id];

  const save = useMutation({
    mutationFn: (next: ProfileValue) => updateRequirementAgentProfile(req.id, { model: next.model, effort: next.effort }),
    // Show the choice at once, so a quick second choice builds on it instead of on the old value.
    onMutate: async (next) => {
      await queryClient.cancelQueries({ queryKey: key });
      const previous = queryClient.getQueryData<Requirement>(key);
      queryClient.setQueryData<Requirement>(key, (old) => (old ? { ...old, agent_model: next.model, agent_effort: next.effort } : old));
      return { previous };
    },
    onSuccess: () => toast.success('Agent model saved; it applies to runs started from now on', { id: `agent-profile-${req.id}` }),
    onError: (err: Error, _next, context) => {
      if (context?.previous) queryClient.setQueryData(key, context.previous);
      toast.error(err.message);
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey: key }),
  });

  return (
    <div className="flex items-center gap-1.5 bg-slate-100 dark:bg-[#1f202b] px-2 py-0.5 rounded-lg border border-slate-200 dark:border-[#2d2f3d]">
      <span className="text-[10px] text-slate-400 font-bold uppercase">Agent:</span>
      <AgentProfilePicker
        value={value}
        onChange={(next) => save.mutate(next)}
        defaultLabel={defaultProfileLabel(workspace ? { value: { model: workspace.agent_model, effort: workspace.agent_effort }, from: 'workspace' } : null)}
      />
    </div>
  );
}
