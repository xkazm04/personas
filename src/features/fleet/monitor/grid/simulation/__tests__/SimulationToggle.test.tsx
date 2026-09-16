/**
 * The toggle's two claims, which are the two a screenshot cannot make:
 *
 *  1. It is ABSENT outside a test build. That is the only thing between mock
 *     data and a shipped installer's Monitor, and it is one `if`.
 *  2. Clicking it flips the shared flag, and clicking again flips it back —
 *     the flag lives in a module store precisely so it survives the Monitor
 *     overlay unmounting, which means a component test is where the round trip
 *     can actually be observed.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';

// Every `t.section.key` resolves to the literal "section.key", so the toggle's
// copy is real strings without loading a catalog.
const t = new Proxy(
  {},
  {
    get: (_s, section: string) =>
      new Proxy({}, { get: (_t, key: string) => `${section}.${key}` }),
  },
);
vi.mock('@/i18n/useTranslation', () => ({ useTranslation: () => ({ t, tx: (s: string) => s }) }));
vi.mock('@/features/shared/components/display/Tooltip', () => ({
  Tooltip: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

import { SimulationToggle } from '../SimulationToggle';
import { _resetSimulationForTests, simulationEnabled } from '../simulationMode';

const testWindow = () => window as unknown as { __PERSONAS_TEST_MODE__?: boolean };

afterEach(() => {
  cleanup();
  delete testWindow().__PERSONAS_TEST_MODE__;
  _resetSimulationForTests();
});

describe('SimulationToggle', () => {
  it('renders nothing when the automation bridge flag is absent', () => {
    render(<SimulationToggle />);
    expect(screen.queryByTestId('fleet-grid-simulation-toggle')).toBeNull();
  });

  it('renders, highlights on, and turns back off in a test build', () => {
    testWindow().__PERSONAS_TEST_MODE__ = true;
    render(<SimulationToggle />);

    const button = screen.getByTestId('fleet-grid-simulation-toggle');
    expect(button).toHaveAttribute('aria-pressed', 'false');
    // Icon-only: the name lives on aria-label, not in the text.
    expect(button).toHaveAttribute('aria-label', 'monitor.grid_simulation');

    fireEvent.click(button);
    expect(simulationEnabled()).toBe(true);
    expect(button).toHaveAttribute('aria-pressed', 'true');
    expect(button.getAttribute('data-simulating')).toBe('true');
    // The highlighted state is a filled gold chip, not a border change — the
    // two states have to be tellable apart in a screenshot.
    expect(button.className).toContain('bg-status-warning');

    fireEvent.click(button);
    expect(simulationEnabled()).toBe(false);
    expect(button).toHaveAttribute('aria-pressed', 'false');
  });
});
