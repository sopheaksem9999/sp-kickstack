import { describe, it, expect } from 'vitest';
import { orderQuestions } from './questions';

const q = (id: number, status: string) => ({ id, status }) as any;

describe('orderQuestions', () => {
  it('puts open questions first, longest waiting first, then the rest newest first', () => {
    expect(orderQuestions([q(1, 'answered'), q(4, 'open'), q(2, 'open'), q(3, 'cancelled')]).map((x) => x.id)).toEqual([2, 4, 3, 1]);
  });
});
