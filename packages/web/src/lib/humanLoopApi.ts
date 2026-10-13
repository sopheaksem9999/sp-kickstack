import type {
  AgentProfileInput,
  AgentQuestion,
  AnswerQuestionInput,
  AnswerQuestionResult,
  BridgeEvent,
  BridgeTask,
  CreateReviewCommentInput,
  ImproveReviewCommentInput,
  ImproveReviewCommentResult,
  NotificationSettings,
  NotificationTestResult,
  QuestionStatus,
  Requirement,
  RequestChangesResult,
  ReviewComment,
  UpdateNotificationSettingsInput,
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

export function answerQuestion(id: number, input: AnswerQuestionInput): Promise<AnswerQuestionResult> {
  return request(`${BASE}/questions/${id}/answer`, send('POST', input));
}

export function fetchReviewComments(reqId: string): Promise<ReviewComment[]> {
  return request(`${BASE}/requirements/${encodeURIComponent(reqId)}/comments`);
}

export function addReviewComment(reqId: string, input: CreateReviewCommentInput): Promise<ReviewComment> {
  return request(`${BASE}/requirements/${encodeURIComponent(reqId)}/comments`, send('POST', input));
}

/** "Improve with AI": the draft rewritten by the AI CLI from Settings; nothing is saved. */
export function improveReviewComment(reqId: string, input: ImproveReviewCommentInput): Promise<ImproveReviewCommentResult> {
  return request(`${BASE}/requirements/${encodeURIComponent(reqId)}/comments/improve`, send('POST', input));
}

export function updateReviewComment(id: number, input: UpdateReviewCommentInput): Promise<ReviewComment> {
  return request(`${BASE}/comments/${id}`, send('PATCH', input));
}

export function deleteReviewComment(id: number): Promise<{ ok: true }> {
  return request(`${BASE}/comments/${id}`, { method: 'DELETE' });
}

/** Request changes; `profile` pins a model / effort on the re-run tasks (omitted parts keep each task's setting). */
export function requestChanges(reqId: string, taskIds?: number[], profile?: AgentProfileInput): Promise<RequestChangesResult> {
  return request(
    `${BASE}/requirements/${encodeURIComponent(reqId)}/request-changes`,
    send('POST', { ...(taskIds ? { task_ids: taskIds } : {}), ...(profile ?? {}) })
  );
}

/** Model / effort for a requirement's runs: undefined keeps a value, null clears it (inherit). */
export function updateRequirementAgentProfile(reqId: string, input: AgentProfileInput): Promise<Requirement> {
  return request(`${BASE}/requirements/${encodeURIComponent(reqId)}/agent-profile`, send('PUT', input));
}

/** Retry a stopped task; `input` pins a model / effort on it (undefined keeps the pin, null clears it). */
export function retryTaskWith(taskId: number, input: AgentProfileInput): Promise<BridgeTask> {
  return request(`${BASE}/tasks/${taskId}/retry`, send('POST', input));
}

export function sendTaskNote(taskId: number, body: string): Promise<{ ok: true }> {
  return request(`${BASE}/tasks/${taskId}/note`, send('POST', { body }));
}

export function fetchNotificationFeed(): Promise<BridgeEvent[]> {
  return request(`${BASE}/notifications`);
}

export function markAllNotificationsRead(): Promise<{ ok: true }> {
  return request(`${BASE}/notifications/read`, send('POST'));
}

export function fetchNotificationSettings(): Promise<NotificationSettings> {
  return request(`${BASE}/settings/notifications`);
}

export function saveNotificationSettings(input: UpdateNotificationSettingsInput): Promise<NotificationSettings> {
  return request(`${BASE}/settings/notifications`, send('PUT', input));
}

export function testNotificationChannel(channelId?: string): Promise<NotificationTestResult[]> {
  return request(`${BASE}/settings/notifications/test`, send('POST', channelId ? { channel_id: channelId } : {}));
}
