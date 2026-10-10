import type { AgentQuestion } from '@sp-kickstack/shared';

/** The answer "Let the agent decide" sends. */
export const LET_AGENT_DECIDE = 'No preference: use your best judgment and note the choice in your report.';

/** Open questions first (longest waiting first), then answered/cancelled ones, newest first. */
export function orderQuestions(questions: AgentQuestion[]): AgentQuestion[] {
  const open = questions.filter((q) => q.status === 'open').sort((a, b) => a.id - b.id);
  const rest = questions.filter((q) => q.status !== 'open').sort((a, b) => b.id - a.id);
  return [...open, ...rest];
}
