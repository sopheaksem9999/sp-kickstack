import type {
  AgentQuestion,
  AnswerQuestionInput,
  CreateReviewCommentInput,
  QuestionStatus,
  RequestChangesResult,
  ReviewComment,
  UpdateReviewCommentInput,
} from '@sp-kickstack/shared';
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

export function fetchReviewComments(reqId: string): Promise<ReviewComment[]> {
  return request(`${BASE}/requirements/${encodeURIComponent(reqId)}/comments`);
}

export function addReviewComment(reqId: string, input: CreateReviewCommentInput): Promise<ReviewComment> {
  return request(`${BASE}/requirements/${encodeURIComponent(reqId)}/comments`, send('POST', input));
}

export function updateReviewComment(id: number, input: UpdateReviewCommentInput): Promise<ReviewComment> {
  return request(`${BASE}/comments/${id}`, send('PATCH', input));
}

export function deleteReviewComment(id: number): Promise<{ ok: true }> {
  return request(`${BASE}/comments/${id}`, { method: 'DELETE' });
}

export function requestChanges(reqId: string, taskIds?: number[]): Promise<RequestChangesResult> {
  return request(`${BASE}/requirements/${encodeURIComponent(reqId)}/request-changes`, send('POST', taskIds ? { task_ids: taskIds } : {}));
}

export function sendTaskNote(taskId: number, body: string): Promise<{ ok: true }> {
  return request(`${BASE}/tasks/${taskId}/note`, send('POST', { body }));
}
