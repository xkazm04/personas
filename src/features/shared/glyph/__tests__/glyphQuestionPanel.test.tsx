import { describe, it, expect, vi } from 'vitest';
import { render, within } from '@testing-library/react';
import type { BuildQuestion } from '@/lib/types/buildTypes';
import { GlyphQuestionPanel } from '../GlyphQuestionPanel';
import { DIM_LABEL, CELL_KEY_TO_DIM } from '../persona-sigil';

/**
 * The card heading names the dimension the answer refines. `cellKey` is the
 * build engine's machine vocabulary — de-hyphenating it ("human-review" →
 * "human review") still renders an English identifier in all 14 locales, and
 * no lint rule sees it because the string is computed, not literal JSX text.
 * These pin the heading to the localized dimension label instead.
 */
function question(cellKey: string): BuildQuestion {
  return { cellKey, question: 'Who signs off?' } as BuildQuestion;
}

function headingOf(container: HTMLElement, cellKey: string): string {
  const card = container.querySelector(`[data-testid="glyph-question-${cellKey}"]`);
  expect(card, `no card rendered for "${cellKey}"`).not.toBeNull();
  // The heading is the second span in the card's icon row; the question body
  // is a <p>, so a text query over the card's spans is unambiguous.
  const spans = within(card as HTMLElement).getAllByText(/.+/, { selector: 'span' });
  return spans.map((s) => s.textContent ?? '').find((txt) => txt.trim().length > 0) ?? '';
}

describe('GlyphQuestionPanel heading', () => {
  it('names the dimension, never the raw cell key', () => {
    for (const [cellKey, dim] of Object.entries(CELL_KEY_TO_DIM)) {
      const { container, unmount } = render(
        <GlyphQuestionPanel questions={[question(cellKey)]} onAnswer={vi.fn()} />,
      );
      const heading = headingOf(container, cellKey);
      expect(heading, `"${cellKey}" heading`).toBe(DIM_LABEL[dim]);
      expect(heading).not.toBe(cellKey.replace(/-/g, ' '));
      unmount();
    }
  });

  it('falls back to the de-hyphenated key only when the cell key maps to no dimension', () => {
    const { container } = render(
      <GlyphQuestionPanel questions={[question('brand-new-cell')]} onAnswer={vi.fn()} />,
    );
    expect(headingOf(container, 'brand-new-cell')).toBe('brand new cell');
  });
});
