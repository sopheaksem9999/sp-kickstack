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

function hostOf(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return 'the URL';
  }
}

/** Error code Node attaches to the real cause of a failed fetch (also inside an AggregateError). */
function codeOf(err: any): string {
  const cause = err?.cause;
  return String(cause?.code ?? cause?.errors?.[0]?.code ?? err?.code ?? '');
}

/**
 * A person reads this in Settings after pressing Test, so it says what to check. It never contains
 * the full URL: Slack and Telegram URLs hold a secret token. The host name is fine.
 */
function failureText(err: any, url: string): string {
  if (err?.name === 'TimeoutError' || err?.name === 'AbortError') {
    return `No answer within ${NOTIFY_TIMEOUT_MS / 1000} seconds. Check the URL and that the service is reachable.`;
  }
  const code = codeOf(err);
  if (code === 'ENOTFOUND' || code === 'EAI_AGAIN') return `Could not find the host ${hostOf(url)}. Check the URL.`;
  if (code === 'ECONNREFUSED' || code === 'ECONNRESET') return 'The host refused the connection. Check the URL and port.';
  const reason = (code || err?.cause?.message || err?.message || String(err)).split(url).join(hostOf(url)).slice(0, 120);
  return `Could not reach the URL (${reason}). Check it and your network.`;
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
          return res.ok
            ? { channel, ok: true }
            : { channel, ok: false, error: `The service answered HTTP ${res.status}. Check the URL (and the token or chat id in it).` };
        } catch (err: any) {
          return { channel, ok: false, error: failureText(err, ch.url) };
        }
      })
    );
  }
}
