import { Response } from 'express';

export class SseBroadcaster {
  private clients = new Set<Response>();

  public addClient(res: Response) {
    this.clients.add(res);
    res.on('close', () => {
      this.clients.delete(res);
    });
  }

  public broadcast(event: { type: string; payload?: unknown; at?: string }) {
    const data = `data: ${JSON.stringify({ ...event, at: event.at || new Date().toISOString() })}\n\n`;
    for (const client of this.clients) {
      try {
        client.write(data);
      } catch (err) {
        this.clients.delete(client);
      }
    }
  }

  public get clientCount(): number {
    return this.clients.size;
  }
}
