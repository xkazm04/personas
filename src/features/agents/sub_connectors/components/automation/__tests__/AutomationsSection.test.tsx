import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import { useVaultStore } from '@/stores/vaultStore';
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

describe('AutomationsSection webhook tests', () => {
  function auto(id: string, name: string) {
    return {
      id, name, personaId: 'p1', platform: 'n8n', deploymentStatus: 'active',
      fallbackMode: 'skip', lastTriggeredAt: null, platformUrl: null, useCaseId: null,
    } as never;
  }
  function testButtons() {
    return screen.getAllByRole('button', { name: /^Test/ });
  }

  // Each card's Test owns its own in-flight state. One shared id let a second
  // test re-enable the first card mid-flight, and the first test's settle
  // cleared the second card's spinner while its webhook was still running.
  it('a settling test does not clear another card that is still testing', async () => {
    const resolvers: Record<string, (v: unknown) => void> = {};
    useVaultStore.setState({
      testAutomation: vi.fn((id: string) => new Promise((r) => { resolvers[id] = r; })),
    } as never);
    render(<AutomationsSection automations={[auto('a1', 'Alpha'), auto('a2', 'Beta')]} onAdd={() => {}} onEdit={() => {}} />);

    fireEvent.click(testButtons()[0]!);
    fireEvent.click(testButtons()[1]!);
    await act(async () => { resolvers.a1!({ status: 'completed', durationMs: 5 }); });

    expect((testButtons()[1] as HTMLButtonElement).disabled).toBe(true);
    await act(async () => { resolvers.a2!({ status: 'completed', durationMs: 5 }); });
    expect((testButtons()[1] as HTMLButtonElement).disabled).toBe(false);
  });
});
