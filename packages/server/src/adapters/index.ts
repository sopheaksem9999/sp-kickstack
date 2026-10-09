import { Project } from '@sp-kickstack/shared';
import { EngineAdapter } from './types.js';
import { StoneforgeAdapter } from './stoneforgeAdapter.js';
import { ManualAdapter } from './manualAdapter.js';

export * from './types.js';
export * from './stoneforgeAdapter.js';
export * from './manualAdapter.js';
export * from './fakeEngine.js';

export function createAdapter(project: Project): EngineAdapter {
  switch (project.engine_type) {
    case 'stoneforge':
      if (!project.engine_url) {
        throw new Error(`Engine URL is required for project ${project.name}`);
      }
      return new StoneforgeAdapter(project.engine_url, project.repo_path);
    case 'manual':
      return new ManualAdapter();
    case 'clinekanban':
      throw new Error(`clinekanban adapter is not yet implemented`);
    default:
      throw new Error(`Unsupported engine type: ${project.engine_type}`);
  }
}
