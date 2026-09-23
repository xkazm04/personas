import { describe, expect, it } from 'vitest';
import { countSentences, foldAfterSentences } from '../replyFold';

describe('countSentences (mirrors scripts/test/lib/reply-shape.mjs)', () => {
  it('counts terminators, a bare line once, and ignores code', () => {
    expect(countSentences('One. Two! Three?')).toBe(3);
    expect(countSentences('No terminator here')).toBe(1);
    expect(countSentences('Look at `a. b. c.` here.')).toBe(1);
    expect(countSentences('Intro.\n```\nx. y. z.\n```')).toBe(1);
    expect(countSentences('')).toBe(0);
  });

  it('counts a list of up to three items as one sentence, a longer list per item', () => {
    expect(countSentences('Plan:\n- a\n- b\n- c')).toBe(2);
    expect(countSentences('Plan:\n- a\n- b\n- c\n- d')).toBe(5);
  });
});

describe('foldAfterSentences', () => {
  it('does not fold below or at the cap', () => {
    expect(foldAfterSentences('One. Two.', 3)).toBeNull();
    expect(foldAfterSentences('One. Two. Three.', 3)).toBeNull();
  });

  it('folds after the cap-th sentence above the cap', () => {
    expect(foldAfterSentences('One. Two. Three. Four. Five.', 3)).toEqual({
      head: 'One. Two. Three.',
      rest: 'Four. Five.',
    });
  });

  it('cuts across lines and keeps a short list whole', () => {
    const text = 'First.\n- a\n- b\nThird. Fourth.';
    expect(foldAfterSentences(text, 2)).toEqual({ head: 'First.\n- a\n- b', rest: 'Third. Fourth.' });
  });

  it('cuts inside a long list at the cap', () => {
    const text = '- a\n- b\n- c\n- d\n- e';
    expect(foldAfterSentences(text, 3)).toEqual({ head: '- a\n- b\n- c', rest: '- d\n- e' });
  });

  it('respects a register cap other than 3', () => {
    expect(foldAfterSentences('A. B.', 1)).toEqual({ head: 'A.', rest: 'B.' });
    expect(foldAfterSentences('A. B. C. D. E.', 8)).toBeNull();
  });
});
