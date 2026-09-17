import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { buildCategoryBuckets } from '../QuestionnaireCategoryRail';

const leaf = (prefix: string) => new Proxy({}, { get: (_o, k) => `${prefix}.${String(k)}` });
const t = new Proxy({}, {
  get: (_o, section) => new Proxy({}, { get: (_s, sub) => leaf(`${String(section)}.${String(sub)}`) }),
});
vi.mock('@/i18n/useTranslation', () => ({
  useTranslation: () => ({ t, tx: (s: unknown) => String(s), language: 'en' }),
  getActiveTranslations: () => t,
}));
vi.mock('@/i18n/DebtText', () => ({ DebtText: () => null }));

import { QuestionnaireStoryThread } from '../QuestionnaireStoryThread';

const q = (id: string, category: string) => ({
  id,
  question: `Question ${id}`,
  type: 'text',
  category,
  options: [],
});

const QUESTIONS = [
  q('c1', 'credentials'),
  q('c2', 'credentials'),
  q('n1', 'notifications'),
  q('n2', 'notifications'),
];

function renderThread(userAnswers: Record<string, string> = {}, activeIdx = 0) {
  const onJumpTo = vi.fn();
  const Thread = QuestionnaireStoryThread as unknown as (p: Record<string, unknown>) => JSX.Element;
  render(
    <Thread
      questions={QUESTIONS}
      userAnswers={userAnswers}
      activeIdx={activeIdx}
      answeredCount={Object.keys(userAnswers).length}
      totalCount={QUESTIONS.length}
      onJumpTo={onJumpTo}
    />,
  );
  return { onJumpTo };
}

describe('questionnaire category rail', () => {
  it('gives every authored category a jump control', () => {
    renderThread();
    expect(screen.getByTestId('questionnaire-category-credentials')).toBeTruthy();
    expect(screen.getByTestId('questionnaire-category-notifications')).toBeTruthy();
  });

  it('jumps to the first unanswered question of the chosen category', () => {
    // On question 2 of Credentials, with c1/c2 done and n1 done: Notifications
    // must land on n2, not on its first question.
    const { onJumpTo } = renderThread({ c1: 'a', c2: 'b', n1: 'c' }, 1);
    fireEvent.click(screen.getByTestId('questionnaire-category-notifications'));
    expect(onJumpTo).toHaveBeenCalledWith(3);
  });

  it('keeps a fully answered category on its first question rather than a dead chip', () => {
    const buckets = buildCategoryBuckets(QUESTIONS, { c1: 'a', c2: 'b' });
    const credentials = buckets.find((b) => b.key === 'credentials')!;
    expect(credentials.jumpIdx).toBe(0);
    expect(credentials.answered).toBe(2);
    expect(credentials.total).toBe(2);
  });

  it('marks the category the hero is on as the current step', () => {
    renderThread({}, 2);
    expect(screen.getByTestId('questionnaire-category-notifications')).toHaveAttribute('aria-current', 'step');
    expect(screen.getByTestId('questionnaire-category-credentials')).not.toHaveAttribute('aria-current');
  });

  it('stays out of the way when every question shares one category', () => {
    const onJumpTo = vi.fn();
    const Thread = QuestionnaireStoryThread as unknown as (p: Record<string, unknown>) => JSX.Element;
    render(
      <Thread
        questions={[q('c1', 'credentials')]}
        userAnswers={{}}
        activeIdx={0}
        answeredCount={0}
        totalCount={1}
        onJumpTo={onJumpTo}
      />,
    );
    expect(screen.queryByTestId('questionnaire-category-credentials')).toBeNull();
  });
});
