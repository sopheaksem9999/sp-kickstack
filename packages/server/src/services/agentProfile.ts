import { AppDatabase } from '../db/index.js';
import type { AgentCliId, ReasoningEffort } from '@sp-kickstack/shared';

export interface AgentProfile {
  model: string | null;
  effort: ReasoningEffort | null;
  /** The requirement's CLI for Local AI CLI runs (null = Settings default). */
  cli: AgentCliId | null;
}

/**
 * Model and effort for a task's next run, each resolved on its own: the task's pin (Retry /
 * Request changes), else its requirement's choice, else its workspace's default; null = the
 * engine decides. A requirement that chooses a CLI skips the workspace model (model names differ
 * per CLI), so that CLI's own Settings model applies.
 */
export function resolveAgentProfile(db: AppDatabase, taskId: number): AgentProfile {
  const row = db
    .prepare(`
      SELECT t.model_override, t.effort_override,
             r.agent_model AS req_model, r.agent_effort AS req_effort, r.agent_cli AS req_cli,
             w.agent_model AS ws_model, w.agent_effort AS ws_effort
      FROM bridge_tasks t
      JOIN requirements r ON r.id = t.req_id
      LEFT JOIN workspaces w ON w.id = r.workspace_id
      WHERE t.id = ?
    `)
    .get(taskId) as Record<string, string | null> | undefined;
  if (!row) return { model: null, effort: null, cli: null };
  const workspaceModel = row.req_cli ? null : row.ws_model;
  return {
    model: row.model_override ?? row.req_model ?? workspaceModel ?? null,
    effort: (row.effort_override ?? row.req_effort ?? row.ws_effort ?? null) as ReasoningEffort | null,
    cli: (row.req_cli ?? null) as AgentCliId | null,
  };
}

/** Fields for the engine create call: only what is set, so engines without support see no change. */
export function engineProfile(profile: AgentProfile): { model?: string; effort?: ReasoningEffort; cli?: AgentCliId } {
  return {
    ...(profile.model ? { model: profile.model } : {}),
    ...(profile.effort ? { effort: profile.effort } : {}),
    ...(profile.cli ? { cli: profile.cli } : {}),
  };
}

/** What a run records: a manual project runs no agent, so no model or effort is claimed for it. */
export function recordedProfile(profile: AgentProfile, engineType: string | undefined): AgentProfile {
  return engineType === 'manual' ? { model: null, effort: null, cli: null } : profile;
}
