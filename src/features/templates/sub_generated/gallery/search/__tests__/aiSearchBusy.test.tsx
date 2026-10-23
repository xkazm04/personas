import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';

const leaf = (prefix: string) => new Proxy({}, { get: (_o, k) => `${prefix}.${String(k)}` });
const t = new Proxy({}, {
  get: (_o, section) => new Proxy({}, { get: (_s, sub) => leaf(`${String(section)}.${String(sub)}`) }),
});
vi.mock('@/i18n/useTranslation', () => ({
  useTranslation: () => ({ t, tx: (s: unknown) => String(s), language: 'en' }),
  getActiveTranslations: () => t,
}));

import { SearchChipInput } from '../suggestions/SearchChipInput';

function renderAi(aiSearchLoading: boolean) {
  const Input = SearchChipInput as unknown as (p: Record<string, unknown>) => JSX.Element;
  render(
    <Input
      chips={[]}
      inputValue="slack digest"
      setInputValue={vi.fn()}
      removeChip={vi.fn()}
      addChip={vi.fn()}
      clearAll={vi.fn()}
      autocompletePrefix={null}
      autocompleteQuery=""
      availableCategories={[]}
      aiSearchMode
      aiSearchLoading={aiSearchLoading}
      onAiSearchSubmit={vi.fn()}
    />,
  );
  return screen.getByRole('button', { name: /search_with_ai_aria/ });
}

describe('AI search send control', () => {
  it('shows it is busy while the AI search runs instead of going blank', () => {
    const send = renderAi(true);
    expect(send.getAttribute('aria-busy')).toBe('true');
    expect((send as HTMLButtonElement).disabled).toBe(true);
    // Something is painted inside the pressed control.
    expect(send.querySelector('svg')).not.toBeNull();
  });

  it('keeps the search glyph in the field while a search runs', () => {
    renderAi(true);
    const field = screen.getByTestId('template-search-input').parentElement!;
    expect(field.firstElementChild?.querySelector('svg')).not.toBeNull();
  });

  it('is an ordinary send control when idle', () => {
    const send = renderAi(false);
    expect(send.getAttribute('aria-busy')).toBeNull();
    expect((send as HTMLButtonElement).disabled).toBe(false);
  });
});
