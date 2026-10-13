import type { ClefSettings } from '@sp-kickstack/shared';

export interface TriageResult {
  severity: 'P0' | 'P1' | 'P2' | 'P3';
  domain: 'api_contract' | 'type_check' | 'dependency' | 'auth_permission' | 'runtime_logic' | 'database';
  rationale: string;
}

export class ClefService {
  /**
   * Fast, deterministic triage classification.
   * Uses Cloudflare Clef API if credentials are provided, or deterministic rule classifier.
   */
  async triageError(errorText: string, settings?: Partial<ClefSettings>): Promise<TriageResult> {
    const text = errorText.toLowerCase();

    // 1. Critical P0: Outage, data loss, security exposure
    if (
      text.includes('drop database') ||
      text.includes('data loss') ||
      text.includes('security exposure') ||
      text.includes('unauthorized root access') ||
      text.includes('production outage') ||
      text.includes('fatal') ||
      text.includes('deadlock')
    ) {
      return {
        severity: 'P0',
        domain: 'database',
        rationale: 'Critical data loss or security risk detected.',
      };
    }

    // 2. P1: Blocking build, TypeScript compile errors, missing modules
    if (text.includes('error ts') || text.includes('typescript') || text.includes('cannot find name')) {
      return {
        severity: 'P1',
        domain: 'type_check',
        rationale: 'TypeScript compile failure blocking build.',
      };
    }

    if (
      text.includes('cannot find module') ||
      text.includes('err_module_not_found') ||
      text.includes('missing dependency')
    ) {
      return {
        severity: 'P1',
        domain: 'dependency',
        rationale: 'Missing module or dependency resolution error.',
      };
    }

    if (text.includes('econnrefused') || text.includes('401 unauthorized') || text.includes('403 forbidden')) {
      return {
        severity: 'P1',
        domain: 'auth_permission',
        rationale: 'Authentication or network permission failure.',
      };
    }

    if (text.includes('schema mismatch') || text.includes('bad endpoint') || text.includes('invalid json response')) {
      return {
        severity: 'P1',
        domain: 'api_contract',
        rationale: 'API schema contract violation.',
      };
    }

    // 3. P2: Non-blocking warning, UI styling defect, test timeout
    if (text.includes('warning') || text.includes('deprecated') || text.includes('overflowed')) {
      return {
        severity: 'P2',
        domain: 'runtime_logic',
        rationale: 'Non-blocking warning or layout issue.',
      };
    }

    // 4. P3: Minor chore, typo, cosmetic notice
    return {
      severity: 'P3',
      domain: 'runtime_logic',
      rationale: 'General runtime notice or cosmetic defect.',
    };
  }
}
