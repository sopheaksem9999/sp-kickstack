import { EngineTask, NormStatus } from '@sp-kickstack/shared';

export class FakeEngineServer {
  private tasks = new Map<string, EngineTask & { notes: string[]; model?: string; effort?: string }>();
  private nextId = 1;
  public url = 'http://127.0.0.1:3457';

  constructor(url: string = 'http://127.0.0.1:3457') {
    this.url = url;
  }

  // Testing helpers
  public setTaskStatus(id: string, status: NormStatus, rawStatus: string, prUrl?: string) {
    const task = this.tasks.get(id);
    if (task) {
      task.status = status;
      task.rawStatus = rawStatus;
      if (prUrl) task.prUrl = prUrl;
    }
  }

  public getTaskData(id: string) {
    return this.tasks.get(id);
  }

  public reset() {
    this.tasks.clear();
    this.nextId = 1;
  }

  public fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const rawUrl = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
    const url = new URL(rawUrl, this.url);
    const pathname = url.pathname;
    const method = (init?.method || 'GET').toUpperCase();
    const body = init?.body ? JSON.parse(init.body as string) : {};

    // Route matching
    if (method === 'GET' && pathname === '/health') {
      return new Response(JSON.stringify({ ok: true, version: 'fake-stoneforge-0.2.0' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    if (method === 'POST' && pathname === '/api/goals') {
      const id = String(this.nextId++);
      const task: EngineTask & { notes: string[]; model?: string; effort?: string } = {
        id,
        title: body.title,
        status: 'queued',
        rawStatus: 'ready',
        url: `${this.url}/tasks/${id}`,
        notes: body.bodyMd ? [body.bodyMd] : [],
        model: body.model,
        effort: body.effort,
      };
      this.tasks.set(id, task);
      return new Response(JSON.stringify(task), {
        status: 201,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    if (method === 'POST' && pathname === '/api/tasks') {
      const id = String(this.nextId++);
      const task: EngineTask & { notes: string[]; model?: string; effort?: string } = {
        id,
        title: body.title,
        status: 'queued',
        rawStatus: 'ready',
        url: `${this.url}/tasks/${id}`,
        notes: body.bodyMd ? [body.bodyMd] : [],
        model: body.model,
        effort: body.effort,
      };
      this.tasks.set(id, task);
      return new Response(JSON.stringify(task), {
        status: 201,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const taskMatch = pathname.match(/^\/api\/tasks\/([^/]+)$/);
    if (method === 'GET' && taskMatch) {
      const id = taskMatch[1];
      const task = this.tasks.get(id);
      if (!task) {
        return new Response(JSON.stringify({ error: 'Task not found' }), {
          status: 404,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      return new Response(JSON.stringify(task), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const holdMatch = pathname.match(/^\/api\/tasks\/([^/]+)\/hold$/);
    if (method === 'POST' && holdMatch) {
      const id = holdMatch[1];
      const task = this.tasks.get(id);
      if (!task) {
        return new Response(JSON.stringify({ error: 'Task not found' }), { status: 404 });
      }
      task.status = 'held';
      task.rawStatus = 'deferred';
      return new Response(JSON.stringify(task), { status: 200 });
    }

    const releaseMatch = pathname.match(/^\/api\/tasks\/([^/]+)\/release$/);
    if (method === 'POST' && releaseMatch) {
      const id = releaseMatch[1];
      const task = this.tasks.get(id);
      if (!task) {
        return new Response(JSON.stringify({ error: 'Task not found' }), { status: 404 });
      }
      if (body.context) {
        task.notes.push(body.context);
      }
      task.status = 'queued';
      task.rawStatus = 'ready';
      return new Response(JSON.stringify(task), { status: 200 });
    }

    const noteMatch = pathname.match(/^\/api\/tasks\/([^/]+)\/note$/);
    if (method === 'POST' && noteMatch) {
      const id = noteMatch[1];
      const task = this.tasks.get(id);
      if (!task) {
        return new Response(JSON.stringify({ error: 'Task not found' }), { status: 404 });
      }
      if (body.bodyMd) {
        task.notes.push(body.bodyMd);
      }
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    }

    const cancelMatch = pathname.match(/^\/api\/tasks\/([^/]+)\/cancel$/);
    if (method === 'POST' && cancelMatch) {
      const id = cancelMatch[1];
      const task = this.tasks.get(id);
      if (!task) {
        return new Response(JSON.stringify({ error: 'Task not found' }), { status: 404 });
      }
      task.status = 'cancelled';
      task.rawStatus = 'closed_cancelled';
      return new Response(JSON.stringify(task), { status: 200 });
    }

    return new Response(JSON.stringify({ error: 'Route not found' }), { status: 404 });
  };
}
