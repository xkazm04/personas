import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import type { TransformQuestionResponse } from '@/api/templates/n8nTransform';

import en from '@/i18n/locales/en.json';
vi.mock('@/i18n/useTranslation', () => ({
  useTranslation: () => ({ t: en, tx: (s: string) => s }),
}));

import { QuestionCard } from '../QuestionnaireFormGridParts';

// A select with allow_custom is not stackable, so the hero question hands it to
// QuestionCard: this is the live path for every free-entry select.
const question = (options: unknown[]) =>
  ({
    id: 'q1',
    question: 'Tone?',
    type: 'select',
    allow_custom: true,
    options,
  }) as unknown as TransformQuestionResponse;

describe('QuestionCard select options', () => {
  it('drops an option with no scalar value instead of rendering "[object Object]"', () => {
    render(
      <QuestionCard
        question={question(['Formal', { value: { nested: true }, label: 'Broken' }, { value: 'casual', label: 'Casual' }])}
        answer=""
        onAnswer={vi.fn()}
        inputOnly
      />,
    );
    expect(screen.getByText('Formal')).toBeTruthy();
    expect(screen.getByText('Casual')).toBeTruthy();
    expect(screen.queryByText('Broken')).toBeNull();
    expect(screen.queryByText('[object Object]')).toBeNull();
  });

  it('drops a blank option instead of rendering an empty pill', () => {
    const { container } = render(
      <QuestionCard question={question(['Formal', '   ', null])} answer="" onAnswer={vi.fn()} inputOnly />,
    );
    const pills = [...container.querySelectorAll('button')].filter((b) => b.textContent?.trim() === '');
    expect(pills).toHaveLength(0);
  });
});
