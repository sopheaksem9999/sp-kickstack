import type { AgentQuestion, AnswerDelivery, NormStatus } from '@sp-kickstack/shared';

/** The answer "Let the agent decide" sends. */
export const LET_AGENT_DECIDE = 'No preference: use your best judgment and note the choice in your report.';

/** Open questions first (longest waiting first), then answered/cancelled ones, newest first. */
export function orderQuestions(questions: AgentQuestion[]): AgentQuestion[] {
  const open = questions.filter((q) => q.status === 'open').sort((a, b) => a.id - b.id);
  const rest = questions.filter((q) => q.status !== 'open').sort((a, b) => b.id - a.id);
  return [...open, ...rest];
}

/** Asker states whose run is over: the answer waits for the next run as a review comment. */
const RUN_ENDED: NormStatus[] = ['in_review', 'qa', 'done', 'failed', 'cancelled'];

/** Header of an open question card: what happens to the answer, given the asking task's state. */
export function askerStateText(question: Pick<AgentQuestion, 'project' | 'asker_status'>): string {
  if (question.asker_status === 'held') return `The ${question.project} agent is paused until you answer`;
  if (RUN_ENDED.includes(question.asker_status)) {
    return `The ${question.project} agent's run has ended; your answer is saved as a review comment for its next run`;
  }
  return `The ${question.project} agent asked this while working; your answer goes to it as a note`;
}

const ANSWER_SENT: Record<AnswerDelivery, string> = {
  resumed: 'Answer sent; the agent continues',
  noted: 'Answer sent; the agent continues once its other dependency is done',
  note: 'Answer sent to the agent as a note',
  review_comment: 'Answer saved as a review comment; use Request changes to send it to the agent',
  pending: 'Answer saved; it reaches the agent as soon as its engine responds',
};

/** Toast after answering: how the answer reached the agent. */
export function answerSentText(delivered: AnswerDelivery): string {
  return ANSWER_SENT[delivered];
}
