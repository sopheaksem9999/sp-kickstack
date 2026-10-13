import { AppDatabase } from '../db/index.js';
import {
  BranchMergeSettings,
  BranchMergeSettingsSchema,
  AiCliSettings,
  AiCliSettingsSchema,
  IdeSettings,
  IdeSettingsSchema,
  LocalEngineSettings,
  LocalEngineSettingsSchema,
  UpdateLocalEngineSettingsInputSchema,
  DEFAULT_NOTIFY_EVENTS,
  NotificationSettings,
  UpdateNotificationSettingsInputSchema,
} from '@sp-kickstack/shared';

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
    return BranchMergeSettingsSchema.parse({});
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

  public getAiCliSettings(): AiCliSettings {
    const row = this.db.prepare("SELECT value FROM settings WHERE key = 'ai_cli_settings'").get() as any;
    if (row && row.value) {
      try {
        const parsed = JSON.parse(row.value);
        return AiCliSettingsSchema.parse(parsed);
      } catch (err) {
        // Fallback to default
      }
    }
    return AiCliSettingsSchema.parse({});
  }

  public updateAiCliSettings(updates: Partial<AiCliSettings>): AiCliSettings {
    const current = this.getAiCliSettings();
    const updated = AiCliSettingsSchema.parse({
      ...current,
      ...updates,
      claude: { ...current.claude, ...updates.claude },
      agy: { ...current.agy, ...updates.agy },
      codex: updates.codex ? { ...(current.codex || {}), ...updates.codex } : current.codex,
      ollama: { ...current.ollama, ...updates.ollama },
      heuristic: updates.heuristic ? { ...(current.heuristic || {}), ...updates.heuristic } : current.heuristic,
    });

    this.db.prepare(`
      INSERT INTO settings (key, value)
      VALUES ('ai_cli_settings', ?)
      ON CONFLICT(key) DO UPDATE SET value = excluded.value
    `).run(JSON.stringify(updated));

    return updated;
  }

  public getIdeSettings(): IdeSettings {
    const row = this.db.prepare("SELECT value FROM settings WHERE key = 'ide_settings'").get() as any;
    if (row && row.value) {
      try {
        const parsed = JSON.parse(row.value);
        return IdeSettingsSchema.parse(parsed);
      } catch {
        // Fallback to default
      }
    }
    return IdeSettingsSchema.parse({});
  }

  public updateIdeSettings(updates: Partial<IdeSettings>): IdeSettings {
    const current = this.getIdeSettings();
    const updated = IdeSettingsSchema.parse({
      ...current,
      ...updates,
    });

    this.db.prepare(`
      INSERT INTO settings (key, value)
      VALUES ('ide_settings', ?)
      ON CONFLICT(key) DO UPDATE SET value = excluded.value
    `).run(JSON.stringify(updated));

    return updated;
  }

  public getLocalEngineSettings(): LocalEngineSettings {
    const row = this.db.prepare("SELECT value FROM settings WHERE key = 'local_engine_settings'").get() as { value: string } | undefined;
    if (row) {
      try {
        return LocalEngineSettingsSchema.parse(JSON.parse(row.value));
      } catch {
        // Fallback to defaults
      }
    }
    return LocalEngineSettingsSchema.parse({});
  }

  /** Partial update; unknown fields and out-of-range values are refused (400 through the API). */
  public updateLocalEngineSettings(updates: unknown): LocalEngineSettings {
    const patch = UpdateLocalEngineSettingsInputSchema.parse(updates ?? {});
    const updated = LocalEngineSettingsSchema.parse({ ...this.getLocalEngineSettings(), ...patch });
    this.db
      .prepare(`
        INSERT INTO settings (key, value) VALUES ('local_engine_settings', ?)
        ON CONFLICT(key) DO UPDATE SET value = excluded.value
      `)
      .run(JSON.stringify(updated));
    return updated;
  }

  public getNotificationSettings(): NotificationSettings {
    const row = this.db.prepare("SELECT value FROM settings WHERE key = 'notification_settings'").get() as { value: string } | undefined;
    let stored: Partial<NotificationSettings> = {};
    if (row) {
      try {
        const parsed = JSON.parse(row.value);
        stored = parsed && typeof parsed === 'object' ? parsed : {};
      } catch {
        stored = {};
      }
    }
    return {
      channels: Array.isArray(stored.channels) ? stored.channels : [],
      events: { ...DEFAULT_NOTIFY_EVENTS, ...(stored.events ?? {}) },
      app_url: typeof stored.app_url === 'string' ? stored.app_url : '',
    };
  }

  public updateNotificationSettings(updates: unknown): NotificationSettings {
    const parsed = UpdateNotificationSettingsInputSchema.parse(updates ?? {});
    const current = this.getNotificationSettings();
    const next: NotificationSettings = {
      channels: parsed.channels ?? current.channels,
      events: { ...current.events, ...(parsed.events ?? {}) },
      app_url: parsed.app_url ?? current.app_url,
    };
    this.db
      .prepare(`
        INSERT INTO settings (key, value) VALUES ('notification_settings', ?)
        ON CONFLICT(key) DO UPDATE SET value = excluded.value
      `)
      .run(JSON.stringify(next));
    return this.getNotificationSettings();
  }
}
