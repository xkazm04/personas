import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { AutomationsSection } from '../AutomationsSection';

/**
 * The collapse toggle used to be a clickable <div> with no role, tabIndex or
 * aria-expanded, so a keyboard user could not open the section at all. It is
 * now a real disclosure button, with the Add control beside it, not inside it.
 */
describe('AutomationsSection header', () => {
  it('is a keyboard-operable disclosure that reports its state', async () => {
    const user = userEvent.setup();
    render(<AutomationsSection automations={[]} onAdd={() => {}} onEdit={() => {}} />);
    const toggle = screen.getByRole('button', { name: /Automations/ });
    expect(toggle.getAttribute('aria-expanded')).toBe('false');

    toggle.focus();
    await user.keyboard('{Enter}');
    expect(toggle.getAttribute('aria-expanded')).toBe('true');
    await user.keyboard(' ');
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
  });

  it('keeps Add outside the disclosure button and does not toggle it', () => {
    const onAdd = vi.fn();
    render(<AutomationsSection automations={[]} onAdd={onAdd} onEdit={() => {}} />);
    const toggle = screen.getByRole('button', { name: /Automations/ });
    const add = screen.getByRole('button', { name: 'Add' });
    expect(toggle.contains(add)).toBe(false);
    fireEvent.click(add);
    expect(onAdd).toHaveBeenCalledTimes(1);
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
  });
});
