import type { BridgeEvent, NotificationChannelConfig, NotificationSettings, NotifyEventType } from '@sp-kickstack/shared';

export type NotificationTone = 'info' | 'success' | 'warning' | 'error';

export interface NotificationText {
  title: string;
  detail: string;
  tone: NotificationTone;
  href?: string;
}

/** Settings labels for the events that can go to Slack/Telegram/webhooks. */
export const NOTIFY_EVENT_LABELS = {
  question_asked: 'An agent asks a question',
  task_needs_human: 'An agent needs help',
  requirement_in_review: 'A requirement is ready for review',
  merge_succeeded: 'Merged and moved to QA',
  merge_failed: 'A merge failed',
  task_failed: 'A task failed',
  task_blocked: 'A task is blocked',
  engine_down: 'An engine is down',
  engine_rate_limited: 'An engine is rate limited',
  changes_requested: 'Changes were requested',
  question_answered: 'A question was answered',
} satisfies Record<NotifyEventType, string>;

export const CHANNEL_HINTS: Record<NotificationChannelConfig['type'], string> = {
  slack: 'Slack incoming-webhook URL, e.g. https://hooks.slack.com/services/T000/B000/XXXX',
  telegram: 'https://api.telegram.org/bot<bot token>/sendMessage?chat_id=<chat id>',
  webhook: 'Any https URL; it receives JSON { type, title, message, payload }',
};

/** Start of each channel type's hint, used as the example in "needs a URL" messages. */
const CHANNEL_EXAMPLES: Record<NotificationChannelConfig['type'], string> = {
  slack: 'https://hooks.slack.com/services/…',
  telegram: 'https://api.telegram.org/bot<token>/sendMessage?chat_id=<chat id>',
  webhook: 'https://example.com/hook',
};

function isHttpUrl(value: string): boolean {
  if (!/^https?:\/\//i.test(value)) return false;
  try {
    new URL(value);
    return true;
  } catch {
    return false;
  }
}

/** First thing to fix before saving, in plain words (what the server would otherwise reject as raw schema text), or null. */
export function notificationDraftProblem(draft: NotificationSettings): string | null {
  for (const [i, channel] of draft.channels.entries()) {
    if (!isHttpUrl(channel.url.trim())) {
      const name = channel.name.trim();
      const label = name ? `"${name}"` : `Channel ${i + 1}`;
      return `${label} needs a URL starting with https://, for example ${CHANNEL_EXAMPLES[channel.type]}.`;
    }
  }
  if (draft.app_url !== '' && !isHttpUrl(draft.app_url.trim())) {
    return 'The link address must start with http:// or https://, for example http://localhost:4101. Leave it empty for no links.';
  }
  return null;
}

export function newChannel(): NotificationChannelConfig {
  return { id: `ch-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`, type: 'slack', name: '', url: '', enabled: true };
}

/** Bell text for an event; null for routine status noise. */
export function describeNotification(event: BridgeEvent): NotificationText | null {
  const p = (event.payload ?? {}) as Record<string, any>;
  const req: string = event.req_id || p.reqId || '';
  const href = req ? `/requirements/${req}` : undefined;
  const first = (v: unknown) => String(v ?? '').split('\n')[0];
  switch (event.type as string) {
    case 'question_asked':
      return { title: `${p.project} agent asks a question`, detail: p.question ?? '', tone: 'warning', href };
    case 'question_answered':
      return { title: 'Question answered', detail: p.answer ?? '', tone: 'success', href };
    case 'task_needs_human':
      return { title: `${p.project} agent needs help`, detail: p.summary || 'Waiting for a person', tone: 'warning', href };
    case 'requirement_in_review':
      return { title: `${req} is ready for review`, detail: 'Review the changes, then merge or request changes', tone: 'info', href };
    case 'changes_requested':
      return { title: `Changes requested on ${req}`, detail: `Round ${p.round}`, tone: 'info', href };
    case 'merge_succeeded':
      return { title: `${req} merged and moved to QA`, detail: '', tone: 'success', href };
    case 'merge_failed':
      return { title: `Merge failed for ${req}`, detail: first(p.error), tone: 'error', href };
    case 'task_failed':
      return { title: p.project ? `A ${p.project} task failed` : 'A task failed', detail: first(p.error || p.reason), tone: 'error', href };
    case 'task_blocked':
      return { title: 'A task is blocked', detail: first(p.reason || p.error), tone: 'warning', href };
    case 'engine_down':
      return { title: `${p.project} engine is down`, detail: 'Work waits until it is reachable', tone: 'error', href };
    case 'engine_up':
      return { title: `${p.project} engine is back`, detail: '', tone: 'success', href };
    case 'engine_rate_limited':
      return { title: `${p.project} engine is rate limited`, detail: 'Work resumes automatically', tone: 'warning', href };
    case 'ticket_created':
      return { title: `New ticket for ${p.target ?? 'another project'}`, detail: '', tone: 'info', href };
    case 'ticket_rejected':
      return {
        title: p.kind === 'question' ? 'A question from the outbox was rejected' : 'A ticket from the outbox was rejected',
        detail: first(p.reason),
        tone: 'error',
        href,
      };
    case 'link_released':
      return { title: 'A dependency was released', detail: '', tone: 'success', href };
    case 'task_retried':
      return { title: p.project ? `A ${p.project} task was retried` : 'A task was retried', detail: '', tone: 'info', href };
    default:
      return null;
  }
}
