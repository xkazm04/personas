import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { PersonaOverviewFilterHeader } from '../PersonaOverviewFilterHeader';

const options = [
  { value: 'all', label: 'All statuses' },
  { value: 'enabled', label: 'Active only' },
  { value: 'disabled', label: 'Disabled only' },
];

describe('PersonaOverviewFilterHeader', () => {
  it('announces itself as a menu trigger and reflects the open state', () => {
    render(<PersonaOverviewFilterHeader label="Status" value="all" options={options} onChange={() => {}} />);
    const trigger = screen.getByRole('button', { name: /status/i });
    expect(trigger.getAttribute('aria-haspopup')).toBe('menu');
    expect(trigger.getAttribute('aria-expanded')).toBe('false');
    expect(screen.queryByRole('menu')).toBeNull();

    fireEvent.click(trigger);
    expect(trigger.getAttribute('aria-expanded')).toBe('true');
    expect(screen.getByRole('menu', { name: 'Status' })).toBeTruthy();
  });

  it('exposes the options as checkable menu items and commits the chosen one', () => {
    const onChange = vi.fn();
    render(<PersonaOverviewFilterHeader label="Status" value="enabled" options={options} onChange={onChange} />);
    fireEvent.click(screen.getByRole('button', { name: /status/i }));

    const items = screen.getAllByRole('menuitemradio');
    expect(items).toHaveLength(3);
    expect(items[1]!.getAttribute('aria-checked')).toBe('true');
    expect(items[0]!.getAttribute('aria-checked')).toBe('false');

    fireEvent.click(items[2]!);
    expect(onChange).toHaveBeenCalledWith('disabled');
    expect(screen.queryByRole('menu')).toBeNull();
  });

  it('closes on Escape', () => {
    render(<PersonaOverviewFilterHeader label="Status" value="all" options={options} onChange={() => {}} />);
    fireEvent.click(screen.getByRole('button', { name: /status/i }));
    expect(screen.getByRole('menu')).toBeTruthy();
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByRole('menu')).toBeNull();
  });
});
