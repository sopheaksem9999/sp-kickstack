export interface NotificationChannel {
  id?: string;
  name?: string;
  type: 'slack' | 'telegram' | 'webhook';
  url: string;
  token?: string;
  enabled: boolean;
}

export interface NotificationResult {
  channel: string;
  ok: boolean;
  error?: string;
}

export interface NotificationMessage {
  type: string;
  title: string;
  message: string;
  payload?: unknown;
}

/** A slow channel must not hold up the scheduler tick. */
export const NOTIFY_TIMEOUT_MS = 10_000;

function bodyFor(channel: NotificationChannel, event: NotificationMessage): string {
  if (channel.type === 'slack') return JSON.stringify({ text: `*${event.title}*\n${event.message}` });
  // Plain text: Telegram rejects Markdown it cannot parse (underscores in code names, for example).
  if (channel.type === 'telegram') return JSON.stringify({ text: `${event.title}\n${event.message}`, disable_web_page_preview: true });
  return JSON.stringify(event);
}

export class Notifier {
  constructor(
    private channels: NotificationChannel[] = [],
    private customFetch: typeof fetch = globalThis.fetch
  ) {}

  /** Post to every enabled channel (the given ones, else the constructor's). Never throws. */
  public async notify(event: NotificationMessage, channels: NotificationChannel[] = this.channels): Promise<NotificationResult[]> {
    const targets = channels.filter((ch) => ch.enabled && ch.url);
    return Promise.all(
      targets.map(async (ch): Promise<NotificationResult> => {
        const channel = ch.name || ch.id || ch.type;
        try {
          const res = await this.customFetch(ch.url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: bodyFor(ch, event),
            signal: AbortSignal.timeout(NOTIFY_TIMEOUT_MS),
          });
          return res.ok ? { channel, ok: true } : { channel, ok: false, error: `HTTP ${res.status}` };
        } catch (err: any) {
          return { channel, ok: false, error: err?.message || String(err) };
        }
      })
    );
  }
}
