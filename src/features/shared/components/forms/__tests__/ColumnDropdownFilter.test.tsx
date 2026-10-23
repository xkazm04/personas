import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

vi.mock('@/i18n/useTranslation', () => ({
  useTranslation: () => ({ t: { common: { clear: 'Clear' } }, tx: (s: string) => s }),
}));

import { ColumnDropdownFilter } from '../ColumnDropdownFilter';

const OPTIONS = [
  { value: 'all', label: 'All' },
  { value: 'failed', label: 'Failed' },
];

describe('ColumnDropdownFilter', () => {
  it('names the icon-only clear control', () => {
    const onChange = vi.fn();
    render(<ColumnDropdownFilter label="Status" value="failed" options={OPTIONS} onChange={onChange} />);
    fireEvent.click(screen.getByRole('button', { name: 'Clear' }));
    expect(onChange).toHaveBeenCalledWith('all');
  });

  it('exposes open state on the trigger and closes on Escape', () => {
    render(<ColumnDropdownFilter label="Status" value="all" options={OPTIONS} onChange={() => {}} />);
    const trigger = screen.getByRole('button', { name: /Status/ });
    expect(trigger.getAttribute('aria-expanded')).toBe('false');
    fireEvent.click(trigger);
    expect(trigger.getAttribute('aria-expanded')).toBe('true');
    expect(screen.getByRole('button', { name: 'Failed' })).toBeTruthy();
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByRole('button', { name: 'Failed' })).toBeNull();
  });

  it('marks the active option as pressed', () => {
    render(<ColumnDropdownFilter label="Status" value="failed" options={OPTIONS} onChange={() => {}} />);
    fireEvent.click(screen.getByRole('button', { name: /Failed/ }));
    const opt = screen.getAllByRole('button', { name: 'Failed' }).find((b) => b.hasAttribute('aria-pressed'));
    expect(opt?.getAttribute('aria-pressed')).toBe('true');
  });
});
