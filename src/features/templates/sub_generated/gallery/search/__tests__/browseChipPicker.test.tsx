import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

const leaf = (prefix: string) => new Proxy({}, { get: (_o, k) => `${prefix}.${String(k)}` });
const t = new Proxy({}, {
  get: (_o, section) => new Proxy({}, { get: (_s, sub) => leaf(`${String(section)}.${String(sub)}`) }),
});
vi.mock('@/i18n/useTranslation', () => ({
  useTranslation: () => ({ t, tx: (s: unknown) => String(s), language: 'en' }),
  getActiveTranslations: () => t,
}));

import { SearchChipInput } from '../suggestions/SearchChipInput';
import type { QueryChip } from '../suggestions/useStructuredQuery';

const CATEGORIES = [{ name: 'communication', count: 3 }, { name: 'productivity', count: 2 }];

function renderInput(overrides: Record<string, unknown> = {}) {
  const addChip = vi.fn();
  const props = {
    chips: [] as QueryChip[],
    inputValue: '',
    setInputValue: vi.fn(),
    removeChip: vi.fn(),
    addChip,
    clearAll: vi.fn(),
    autocompletePrefix: null,
    autocompleteQuery: '',
    availableCategories: CATEGORIES,
    ...overrides,
  };
  const Input = SearchChipInput as unknown as (p: Record<string, unknown>) => JSX.Element;
  render(<Input {...props} />);
  return { addChip, input: screen.getByTestId('template-search-input') };
}

describe('browse chip picker', () => {
  it('stays closed until the operator asks for it', () => {
    renderInput();
    expect(screen.queryByRole('listbox')).toBeNull();
  });

  it('opens all three chip groups when the empty input is focused', () => {
    const { input } = renderInput();
    fireEvent.focus(input);
    expect(screen.getByRole('listbox')).toBeTruthy();
    expect(screen.getByRole('group', { name: /autocomplete_categories/ })).toBeTruthy();
    expect(screen.getByRole('group', { name: /autocomplete_difficulty/ })).toBeTruthy();
    expect(screen.getByRole('group', { name: /autocomplete_setup_time/ })).toBeTruthy();
  });

  it.each([
    ['Beginner', 'difficulty', 'beginner'],
    ['Quick Setup', 'setup', 'quick'],
    ['Communication', 'category', 'communication'],
  ])('adds a %s chip without typing a prefix', (label, type, value) => {
    const { addChip, input } = renderInput();
    fireEvent.focus(input);
    fireEvent.click(screen.getByRole('option', { name: label }));
    expect(addChip).toHaveBeenCalledWith(expect.objectContaining({ type, value }));
  });

  it('does not offer a facet that is already on', () => {
    const { input } = renderInput({
      chips: [{ type: 'difficulty', value: 'beginner', label: 'Beginner' }] as QueryChip[],
    });
    fireEvent.focus(input);
    expect(screen.queryByRole('option', { name: 'Beginner' })).toBeNull();
    expect(screen.getByRole('option', { name: 'Advanced' })).toBeTruthy();
  });

  it('yields to the typed prefix rather than showing every group at once', () => {
    const { input } = renderInput({ inputValue: 'difficulty:', autocompletePrefix: 'difficulty:' });
    fireEvent.focus(input);
    expect(screen.getByRole('group', { name: /autocomplete_difficulty/ })).toBeTruthy();
    expect(screen.queryByRole('group', { name: /autocomplete_categories/ })).toBeNull();
  });

  it('stays out of the way in AI search mode', () => {
    const { input } = renderInput({ aiSearchMode: true });
    fireEvent.focus(input);
    expect(screen.queryByRole('listbox')).toBeNull();
  });
});
