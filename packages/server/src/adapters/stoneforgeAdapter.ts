import { EngineTask, NormStatus } from '@sp-kickstack/shared';
import { CreateEngineTaskInput, EngineAdapter } from './types.js';

export class StoneforgeAdapter implements EngineAdapter {
  public type = 'stoneforge' as const;

  constructor(
    private baseUrl: string,
    private repoPath: string,
    private token?: string,
    private customFetch: typeof fetch = globalThis.fetch
  ) {}

  private async fetchJson<T>(path: string, options: RequestInit = {}): Promise<T> {
    const url = `${this.baseUrl}${path}`;
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      ...(this.token ? { Authorization: `Bearer ${this.token}` } : {}),
      ...((options.headers as Record<string, string>) || {}),
    };

    const res = await this.customFetch(url, { ...options, headers });
    if (!res.ok) {
      const errorText = await res.text().catch(() => res.statusText);
      throw new Error(`Engine request failed (${res.status}): ${errorText}`);
    }
    return (await res.json()) as T;
  }

  public normalizeStatus(rawStatus: string): NormStatus {
    const s = rawStatus.toLowerCase();
    if (s === 'ready' || s === 'queued' || s === 'pending') return 'queued';
    if (s === 'in_progress' || s === 'running' || s === 'active') return 'running';
    if (s === 'deferred' || s === 'held' || s === 'waiting') return 'held';
    if (s === 'needs_review' || s === 'review' || s === 'steward_review') return 'in_review';
    if (s === 'done' || s === 'merged' || s === 'completed' || s === 'closed_done') return 'done';
    if (s === 'failed' || s === 'error' || s === 'abandoned') return 'failed';
    if (s === 'cancelled' || s === 'canceled' || s === 'closed_cancelled') return 'cancelled';
    if (s === 'needs_human' || s === 'blocked') return 'needs_human';
    return 'needs_human';
  }

  public async health(): Promise<{ ok: boolean; version?: string; error?: string }> {
    try {
      const data = await this.fetchJson<{ ok: boolean; version?: string }>('/health');
      return { ok: true, version: data.version || 'stoneforge' };
    } catch (err: any) {
      return { ok: false, error: err.message };
    }
  }

  public async createGoal(input: CreateEngineTaskInput): Promise<EngineTask> {
    const data = await this.fetchJson<any>('/api/goals', {
      method: 'POST',
      body: JSON.stringify(input),
    });
    return {
      id: String(data.id),
      title: data.title || input.title,
      status: this.normalizeStatus(data.status || data.rawStatus || 'queued'),
      rawStatus: data.rawStatus || data.status || 'queued',
      url: data.url || `${this.baseUrl}/tasks/${data.id}`,
      prUrl: data.prUrl,
      summary: data.summary,
    };
  }

  public async createTask(input: CreateEngineTaskInput): Promise<EngineTask> {
    const data = await this.fetchJson<any>('/api/tasks', {
      method: 'POST',
      body: JSON.stringify(input),
    });
    return {
      id: String(data.id),
      title: data.title || input.title,
      status: this.normalizeStatus(data.status || data.rawStatus || 'queued'),
      rawStatus: data.rawStatus || data.status || 'queued',
      url: data.url || `${this.baseUrl}/tasks/${data.id}`,
      prUrl: data.prUrl,
      summary: data.summary,
    };
  }

  public async getTask(id: string): Promise<EngineTask | null> {
    try {
      const data = await this.fetchJson<any>(`/api/tasks/${id}`);
      return {
        id: String(data.id),
        title: data.title,
        status: this.normalizeStatus(data.status || data.rawStatus || 'queued'),
        rawStatus: data.rawStatus || data.status || 'queued',
        url: data.url || `${this.baseUrl}/tasks/${data.id}`,
        prUrl: data.prUrl,
        summary: data.summary,
      };
    } catch (err: any) {
      if (err.message.includes('404')) return null;
      throw err;
    }
  }

  public async listTasks(ids: string[]): Promise<EngineTask[]> {
    const tasks: EngineTask[] = [];
    for (const id of ids) {
      const task = await this.getTask(id);
      if (task) tasks.push(task);
    }
    return tasks;
  }

  public async holdTask(id: string, reason: string): Promise<void> {
    await this.fetchJson(`/api/tasks/${id}/hold`, {
      method: 'POST',
      body: JSON.stringify({ reason }),
    });
  }

  public async releaseTask(id: string, context: string): Promise<void> {
    await this.fetchJson(`/api/tasks/${id}/release`, {
      method: 'POST',
      body: JSON.stringify({ context }),
    });
  }

  public async appendNote(id: string, bodyMd: string): Promise<void> {
    await this.fetchJson(`/api/tasks/${id}/note`, {
      method: 'POST',
      body: JSON.stringify({ bodyMd }),
    });
  }

  public async cancelTask(id: string): Promise<void> {
    await this.fetchJson(`/api/tasks/${id}/cancel`, {
      method: 'POST',
    });
  }
}
