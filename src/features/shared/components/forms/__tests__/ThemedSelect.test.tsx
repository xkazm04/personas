import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

vi.mock('@/i18n/useTranslation', () => ({
  useTranslation: () => ({
    t: { shared: { forms_extra: { filter_placeholder: 'Filter...', no_matches: 'No matches' } } },
    tx: (s: string) => s,
  }),
}));

import { ThemedSelect } from '../ThemedSelect';

const OPTIONS = [
  { value: 'a', label: 'Alpha' },
  { value: 'b', label: 'Bravo' },
];

function renderSelect(onValueChange = vi.fn(), hideSearch = false) {
  render(
    <ThemedSelect
      filterable
      hideSearch={hideSearch}
      aria-label="Region"
      options={OPTIONS}
      value="a"
      onValueChange={onValueChange}
    />,
  );
  const trigger = screen.getByRole('button', { name: 'Region' });
  fireEvent.click(trigger);
  return trigger;
}

describe('ThemedSelect (filterable) keyboard contract', () => {
  it('closes on Escape from the search field and returns focus to the trigger', () => {
    const trigger = renderSelect();
    const search = screen.getByPlaceholderText('Filter...');
    search.focus();
    fireEvent.keyDown(search, { key: 'Escape' });
    expect(screen.queryByText('Bravo')).toBeNull();
    expect(trigger.getAttribute('aria-expanded')).toBe('false');
    expect(document.activeElement).toBe(trigger);
  });

  it('closes on Escape with the search hidden (focus still on the trigger)', () => {
    const trigger = renderSelect(vi.fn(), true);
    expect(screen.getByText('Bravo')).toBeTruthy();
    trigger.focus();
    fireEvent.keyDown(trigger, { key: 'Escape' });
    expect(screen.queryByText('Bravo')).toBeNull();
  });

  it('keeps an Escape that closed the menu from reaching an outer (modal) handler', () => {
    const outer = vi.fn();
    render(
      <div onKeyDown={outer}>
        <ThemedSelect filterable aria-label="Zone" options={OPTIONS} value="a" onValueChange={vi.fn()} />
      </div>,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Zone' }));
    fireEvent.keyDown(screen.getByPlaceholderText('Filter...'), { key: 'Escape' });
    expect(outer).not.toHaveBeenCalled();
  });

  it('returns focus to the trigger after an option is chosen', () => {
    const onValueChange = vi.fn();
    const trigger = renderSelect(onValueChange);
    const option = screen.getByText('Bravo').closest('button')!;
    option.focus();
    fireEvent.click(option);
    expect(onValueChange).toHaveBeenCalledWith('b');
    expect(document.activeElement).toBe(trigger);
  });
});
