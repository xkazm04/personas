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

  it('closes on an outside press but not on a press inside the portalled panel or trigger', () => {
    render(<PersonaOverviewFilterHeader label="Status" value="all" options={options} onChange={() => {}} />);
    const trigger = screen.getByRole('button', { name: /status/i });
    fireEvent.click(trigger);
    fireEvent.mouseDown(screen.getByRole('menu'));
    fireEvent.mouseDown(trigger);
    expect(screen.getByRole('menu')).toBeTruthy();
    fireEvent.mouseDown(document.body);
    expect(screen.queryByRole('menu')).toBeNull();
  });

  // Round 2 card 9: role="menu" announced a menu that kept focus on the
  // trigger and ignored the arrow keys.
  it('focuses the checked option on open, moves with arrows, and returns focus on close', () => {
    render(<PersonaOverviewFilterHeader label="Status" value="enabled" options={options} onChange={() => {}} />);
    const trigger = screen.getByRole('button', { name: /status/i });
    fireEvent.click(trigger);
    const items = screen.getAllByRole('menuitemradio');
    expect(document.activeElement).toBe(items[1]);
    fireEvent.keyDown(screen.getByRole('menu'), { key: 'ArrowDown' });
    expect(document.activeElement).toBe(items[2]);
    fireEvent.keyDown(screen.getByRole('menu'), { key: 'ArrowDown' });
    expect(document.activeElement).toBe(items[0]);
    fireEvent.keyDown(screen.getByRole('menu'), { key: 'End' });
    expect(document.activeElement).toBe(items[2]);
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(document.activeElement).toBe(trigger);
  });

  it('closes on Escape', () => {
    render(<PersonaOverviewFilterHeader label="Status" value="all" options={options} onChange={() => {}} />);
    fireEvent.click(screen.getByRole('button', { name: /status/i }));
    expect(screen.getByRole('menu')).toBeTruthy();
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByRole('menu')).toBeNull();
  });
});
