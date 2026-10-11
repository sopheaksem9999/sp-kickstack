import { describe, it, expect } from 'vitest';
import { answerSentText, askerStateText, orderQuestions } from './questions';

const q = (id: number, status: string) => ({ id, status }) as any;

describe('orderQuestions', () => {
  it('puts open questions first, longest waiting first, then the rest newest first', () => {
    expect(orderQuestions([q(1, 'answered'), q(4, 'open'), q(2, 'open'), q(3, 'cancelled')]).map((x) => x.id)).toEqual([2, 4, 3, 1]);
  });
});

describe('askerStateText', () => {
  const card = (asker_status: string) => askerStateText({ project: 'mobile', asker_status } as any);

  it('says the agent is paused while its task is held', () => {
    expect(card('held')).toBe('The mobile agent is paused until you answer');
  });

  it('says the answer goes as a note while the task still runs', () => {
    for (const status of ['pending', 'queued', 'running', 'needs_human', 'rate_limited']) {
      expect(card(status), status).toBe('The mobile agent asked this while working; your answer goes to it as a note');
    }
  });

  it('says the answer is saved for the next run once the run has ended', () => {
    for (const status of ['in_review', 'qa', 'done', 'failed', 'cancelled']) {
      expect(card(status), status).toBe("The mobile agent's run has ended; your answer is saved as a review comment for its next run");
    }
  });
});

describe('answerSentText', () => {
  it('tells the person what happened to the answer', () => {
    expect(answerSentText('resumed')).toBe('Answer sent; the agent continues');
    expect(answerSentText('noted')).toBe('Answer sent; the agent continues once its other dependency is done');
    expect(answerSentText('note')).toBe('Answer sent to the agent as a note');
    expect(answerSentText('review_comment')).toBe('Answer saved as a review comment; use Request changes to send it to the agent');
    expect(answerSentText('pending')).toBe('Answer saved; it reaches the agent as soon as its engine responds');
  });
});
