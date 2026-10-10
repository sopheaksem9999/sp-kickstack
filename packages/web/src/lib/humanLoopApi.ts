import type { AgentQuestion, AnswerQuestionInput, QuestionStatus } from '@sp-kickstack/shared';
import { BASE } from './api.js';

/** fetch + JSON, throwing the server's `error` message (or the HTTP status) on failure. */
async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, init);
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((body as { error?: string })?.error || `Request failed (${res.status})`);
  return body as T;
}

function send(method: string, body?: unknown): RequestInit {
  return {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  };
}

export function fetchQuestions(params: { status?: QuestionStatus; reqId?: string } = {}): Promise<AgentQuestion[]> {
  const query = new URLSearchParams();
  if (params.status) query.set('status', params.status);
  if (params.reqId) query.set('req', params.reqId);
  const qs = query.toString();
  return request(`${BASE}/questions${qs ? `?${qs}` : ''}`);
}

export function answerQuestion(id: number, input: AnswerQuestionInput): Promise<AgentQuestion> {
  return request(`${BASE}/questions/${id}/answer`, send('POST', input));
}
