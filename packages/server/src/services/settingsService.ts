import { AppDatabase } from '../db/index.js';
import { BranchMergeSettings, BranchMergeSettingsSchema } from '@sp-kickstack/shared';

export class SettingsService {
  constructor(private db: AppDatabase) {}

  public getBranchMergeSettings(): BranchMergeSettings {
    const row = this.db.prepare("SELECT value FROM settings WHERE key = 'branch_merge_settings'").get() as any;
    if (row && row.value) {
      try {
        const parsed = JSON.parse(row.value);
        return BranchMergeSettingsSchema.parse(parsed);
      } catch (err) {
        // Fallback to default
      }
    }
    return {
      default_base_branch: 'develop',
      merge_policy: 'manual_review_merge',
      auto_delete_branch: false,
    };
  }

  public updateBranchMergeSettings(updates: Partial<BranchMergeSettings>): BranchMergeSettings {
    const current = this.getBranchMergeSettings();
    const updated = BranchMergeSettingsSchema.parse({
      ...current,
      ...updates,
    });

    this.db.prepare(`
      INSERT INTO settings (key, value)
      VALUES ('branch_merge_settings', ?)
      ON CONFLICT(key) DO UPDATE SET value = excluded.value
    `).run(JSON.stringify(updated));

    return updated;
  }
}
