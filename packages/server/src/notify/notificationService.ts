import { AppDatabase } from '../db/index.js';
import { NotificationTestResult } from '@sp-kickstack/shared';
import { HttpError } from '../lib/httpError.js';
import { SettingsService } from '../services/settingsService.js';
import { Notifier } from './notifier.js';

const CURSOR_KEY = 'notification_cursor';

interface EventRow {
  id: number;
  type: string;
  req_id: string | null;
  payload: string;
}

function parsePayload(raw: string): Record<string, any> {
  try {
    const value = JSON.parse(raw || '{}');
    return value && typeof value === 'object' ? value : {};
  } catch {
    return {};
  }
}

/** ISO time for a value that should be a date; '' when it is missing or not a date. */
function isoOrEmpty(value: unknown): string {
  if (!value) return '';
  const date = new Date(value as string);
  return Number.isNaN(date.getTime()) ? '' : date.toISOString();
}

/** Plain-words title and message for a notifiable event; null for events people are not told about. */
export function describeEvent(
  event: { type: string; req_id: string | null; payload: Record<string, any> },
  appUrl = ''
): { title: string; message: string } | null {
  const p = event.payload ?? {};
  const req: string = event.req_id || p.reqId || '';
  const on = req ? ` (${req})` : '';
  const link = appUrl && req ? `\n${appUrl.replace(/\/+$/, '')}/requirements/${req}` : '';
  switch (event.type) {
    case 'question_asked':
      return {
        title: `${p.project} agent asks a question${on}`,
        message: `${p.question ?? ''}${Array.isArray(p.options) && p.options.length ? `\nOptions: ${p.options.join(' / ')}` : ''}${link}`,
      };
    case 'task_needs_human':
      return { title: `${p.project} agent needs help${on}`, message: `${p.summary || 'The agent stopped and is waiting for a person.'}${link}` };
    case 'requirement_in_review':
      return { title: `${req} is ready for review`, message: `All tasks finished. Review the changes, then merge or request changes.${link}` };
    case 'merge_succeeded': {
      const warnings = Array.isArray(p.warnings) && p.warnings.length ? p.warnings.join('\n') : 'Every task branch was merged and pushed.';
      return { title: `${req} merged and moved to QA`, message: `${warnings}${link}` };
    }
    case 'merge_failed':
      return { title: `Merge failed for ${req}`, message: `${String(p.error ?? '').split('\n')[0]}${link}` };
    case 'task_failed':
      return { title: p.project ? `A ${p.project} task failed${on}` : `A task failed${on}`, message: `${p.error || p.reason || 'Open the requirement to retry it.'}${link}` };
    case 'task_blocked':
      return { title: `A task is blocked${on}`, message: `${p.reason || p.error || 'It waits on work that failed or was cancelled.'}${link}` };
    case 'engine_down':
      return { title: `${p.project} engine is down`, message: 'Work for this project waits until the engine is reachable again.' };
    case 'engine_rate_limited': {
      const until = isoOrEmpty(p.until);
      return { title: `${p.project} engine is rate limited`, message: `Work resumes automatically${until ? ` at ${until}` : ''}.` };
    }
    case 'changes_requested':
      return {
        title: `Changes requested on ${req}`,
        message: `Round ${p.round}: ${Array.isArray(p.taskIds) ? p.taskIds.length : 0} task(s) started a new run.${link}`,
      };
    case 'question_answered':
      return { title: `Question answered${req ? ` on ${req}` : ''}`, message: `${p.answer ?? ''}${link}` };
    default:
      return null;
  }
}

/**
 * Sends new events to the notification channels in Settings. Reads the event log after a
 * persisted cursor (the first run starts at the end: no history replay), so every event is
 * sent at most once, also across restarts. Runs on the scheduler tick.
 */
export class NotificationService {
  constructor(
    private db: AppDatabase,
    private settings: SettingsService,
    private notifier: Notifier
  ) {}

  public async dispatchPending(limit = 100): Promise<number> {
    const cursor = this.readCursor();
    if (cursor === null) {
      this.writeCursor(this.lastEventId());
      return 0;
    }
    const rows = this.db.prepare('SELECT id, type, req_id, payload FROM events WHERE id > ? ORDER BY id LIMIT ?').all(cursor, limit) as EventRow[];
    if (rows.length === 0) return 0;

    const settings = this.settings.getNotificationSettings();
    const channels = settings.channels.filter((c) => c.enabled);
    let sent = 0;
    for (const row of rows) {
      if (channels.length > 0 && settings.events[row.type]) {
        try {
          const payload = parsePayload(row.payload);
          const text = describeEvent({ type: row.type, req_id: row.req_id, payload }, settings.app_url);
          if (text) {
            await this.notifier.notify({ type: row.type, ...text, payload }, channels);
            sent++;
          }
        } catch (err: any) {
          // One malformed event must not hold the cursor back and be retried forever.
          console.warn(`[notify] skipped event ${row.id} (${row.type}): ${err?.message || err}`);
        }
      }
      this.writeCursor(row.id);
    }
    return sent;
  }

  /** Send a test message to one channel (by id, even if disabled) or to every enabled channel. */
  public async sendTest(channelId?: string): Promise<NotificationTestResult[]> {
    const all = this.settings.getNotificationSettings().channels;
    const targets = channelId ? all.filter((c) => c.id === channelId) : all.filter((c) => c.enabled);
    if (channelId && targets.length === 0) {
      throw new HttpError(404, `No notification channel "${channelId}". Save the channel first, then send the test again.`);
    }
    return this.notifier.notify(
      { type: 'test', title: 'Test notification', message: 'Notifications from SP Kickstack reach this channel.' },
      targets.map((c) => ({ ...c, enabled: true }))
    );
  }

  private readCursor(): number | null {
    const row = this.db.prepare('SELECT value FROM settings WHERE key = ?').get(CURSOR_KEY) as { value: string } | undefined;
    const id = row ? Number(row.value) : NaN;
    // A missing or unreadable cursor starts again at the end of the log (no history replay).
    return Number.isFinite(id) ? id : null;
  }

  private writeCursor(id: number) {
    this.db
      .prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value')
      .run(CURSOR_KEY, String(id));
  }

  private lastEventId(): number {
    return (this.db.prepare('SELECT COALESCE(MAX(id), 0) AS id FROM events').get() as { id: number }).id;
  }
}
