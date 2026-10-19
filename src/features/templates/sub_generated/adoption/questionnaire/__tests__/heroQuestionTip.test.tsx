import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import type { TransformQuestionResponse } from '@/api/templates/n8nTransform';

import en from '@/i18n/locales/en.json';
vi.mock('@/i18n/useTranslation', () => ({
  useTranslation: () => ({ t: en, tx: (s: string) => s }),
}));

import { QuestionnaireHeroQuestion } from '../QuestionnaireHeroQuestion';

const QUESTION = {
  id: 'q1',
  question: 'How often?',
  type: 'text',
  context: 'Pick the cadence your team reads the digest at.',
} as TransformQuestionResponse;

describe('QuestionnaireHeroQuestion context tip', () => {
  it('names its icon-only toggle and renames it once open', () => {
    render(
      <QuestionnaireHeroQuestion
        question={QUESTION}
        answer=""
        options={[]}
        isStackable={false}
        isBlocked={false}
        isAutoDetected={false}
        onAnswerUpdated={vi.fn()}
      />,
    );
    const toggle = screen.getByRole('button', { name: en.templates.adopt_modal.show_explanation });
    fireEvent.click(toggle);
    expect(screen.getByRole('button', { name: en.templates.adopt_modal.hide_explanation })).toBeTruthy();
  });
});
