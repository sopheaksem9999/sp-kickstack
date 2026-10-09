export interface NotificationChannel {
  type: 'slack' | 'telegram' | 'webhook';
  url: string;
  token?: string;
  enabled: boolean;
}

export class Notifier {
  constructor(
    private channels: NotificationChannel[] = [],
    private customFetch: typeof fetch = globalThis.fetch
  ) {}

  public async notify(event: { type: string; title: string; message: string; payload?: unknown }) {
    for (const ch of this.channels) {
      if (!ch.enabled || !ch.url) continue;

      try {
        let body: string;
        if (ch.type === 'slack') {
          body = JSON.stringify({ text: `*[DevFlow Bridge]* ${event.title}\n${event.message}` });
        } else if (ch.type === 'telegram') {
          body = JSON.stringify({ text: `*DevFlow Bridge: ${event.title}*\n${event.message}`, parse_mode: 'Markdown' });
        } else {
          body = JSON.stringify(event);
        }

        await this.customFetch(ch.url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body,
        });
      } catch (err) {
        // Delivery failure never crashes workflow
      }
    }
  }
}
