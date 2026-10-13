import { EngineTask, NormStatus } from '@sp-kickstack/shared';
import { CreateEngineTaskInput, EngineAdapter } from './types.js';
import { DEFAULT_RATE_LIMIT_WAIT_MS, EngineRateLimitError, isRateLimit, parseRetryAfter } from './rateLimit.js';

/** Resume time an engine reports for a rate-limited task, in whichever field it uses. */
function resumeAtOf(data: any): string | undefined {
  const value = data?.resumeAt ?? data?.resetAt ?? data?.rateLimitResetAt ?? data?.rate_limit_reset_at;
  return typeof value === 'string' && value ? value : undefined;
}

const RATE_LIMIT_STATUSES = new Set(['rate_limited', 'rate-limited', 'ratelimited', 'quota_exceeded', 'usage_limited', 'throttled']);

/** The create request body: exactly the fields Stoneforge has always received (never bridgeTaskId). */
function engineBody(input: CreateEngineTaskInput) {
  const { title, bodyMd, priority, labels, model, effort } = input;
  return { title, bodyMd, priority, labels, model, effort };
}

export class StoneforgeAdapter implements EngineAdapter {
  public type = 'stoneforge' as const;

  constructor(
    private baseUrl: string,
    private repoPath: string,
    private token?: string,
    private customFetch: typeof fetch = globalThis.fetch,
    private timeoutMs: number = Number(process.env.ENGINE_TIMEOUT_MS) || 10000
  ) {}

  private async fetchJson<T>(path: string, options: RequestInit = {}): Promise<T> {
    const url = `${this.baseUrl}${path}`;
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      ...(this.token ? { Authorization: `Bearer ${this.token}` } : {}),
      ...((options.headers as Record<string, string>) || {}),
    };

    // A hung engine must not stall the watcher or a request forever.
    const res = await this.customFetch(url, {
      ...options,
      headers,
      signal: options.signal ?? AbortSignal.timeout(this.timeoutMs),
    });
    if (res.status === 429) {
      const wait = parseRetryAfter(res.headers.get('retry-after')) ?? DEFAULT_RATE_LIMIT_WAIT_MS;
      const detail = (await res.text().catch(() => '')).trim();
      throw new EngineRateLimitError(`Engine rate limited (429)${detail ? `: ${detail}` : ''}`, wait);
    }
    if (!res.ok) {
      const errorText = await res.text().catch(() => res.statusText);
      throw new Error(`Engine request failed (${res.status}): ${errorText}`);
    }
    return (await res.json()) as T;
  }

  public normalizeStatus(rawStatus: string): NormStatus {
    const s = rawStatus.toLowerCase();
    if (RATE_LIMIT_STATUSES.has(s)) return 'rate_limited';
    if (s === 'ready' || s === 'queued' || s === 'pending') return 'queued';
    if (s === 'in_progress' || s === 'running' || s === 'active') return 'running';
    if (s === 'deferred' || s === 'held' || s === 'waiting') return 'held';
    if (s === 'needs_review' || s === 'review' || s === 'steward_review' || s === 'in_review' || s === 'qa') return 'in_review';
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
      // A rate-limited engine is up; the caller must back off, not mark it down.
      if (isRateLimit(err)) throw err;
      return { ok: false, error: err.message };
    }
  }

  public async createGoal(input: CreateEngineTaskInput): Promise<EngineTask> {
    const data = await this.fetchJson<any>('/api/goals', {
      method: 'POST',
      body: JSON.stringify(engineBody(input)),
    });
    return {
      id: String(data.id),
      title: data.title || input.title,
      status: this.normalizeStatus(data.status || data.rawStatus || 'queued'),
      rawStatus: data.rawStatus || data.status || 'queued',
      url: data.url || `${this.baseUrl}/tasks/${data.id}`,
      prUrl: data.prUrl,
      summary: data.summary,
      resumeAt: resumeAtOf(data),
    };
  }

  public async createTask(input: CreateEngineTaskInput): Promise<EngineTask> {
    const data = await this.fetchJson<any>('/api/tasks', {
      method: 'POST',
      body: JSON.stringify(engineBody(input)),
    });
    return {
      id: String(data.id),
      title: data.title || input.title,
      status: this.normalizeStatus(data.status || data.rawStatus || 'queued'),
      rawStatus: data.rawStatus || data.status || 'queued',
      url: data.url || `${this.baseUrl}/tasks/${data.id}`,
      prUrl: data.prUrl,
      summary: data.summary,
      resumeAt: resumeAtOf(data),
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
        resumeAt: resumeAtOf(data),
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
