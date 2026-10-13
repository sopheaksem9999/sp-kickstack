import { Project } from '@sp-kickstack/shared';
import { EngineAdapter } from './types.js';
import { StoneforgeAdapter } from './stoneforgeAdapter.js';
import { ManualAdapter } from './manualAdapter.js';
import { LocalCliAdapter, type LocalEngine } from './localCliAdapter.js';

export * from './types.js';
export * from './stoneforgeAdapter.js';
export * from './manualAdapter.js';
export * from './localCliAdapter.js';
export * from './fakeEngine.js';

export interface AdapterDeps {
  /** The in-server Local AI CLI engine; absent outside the bridge server (e.g. the MCP process). */
  local?: LocalEngine;
}

export function createAdapter(project: Project, deps: AdapterDeps = {}): EngineAdapter {
  switch (project.engine_type) {
    case 'stoneforge':
      if (!project.engine_url) {
        throw new Error(`Engine URL is required for project ${project.name}`);
      }
      return new StoneforgeAdapter(project.engine_url, project.repo_path);
    case 'manual':
      return new ManualAdapter();
    case 'local':
      if (!deps.local) throw new Error('The Local AI CLI engine runs only inside the bridge server');
      return new LocalCliAdapter(project, deps.local);
    case 'clinekanban':
      throw new Error(`clinekanban adapter is not yet implemented`);
    default:
      throw new Error(`Unsupported engine type: ${project.engine_type}`);
  }
}
