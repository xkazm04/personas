// UsageStrip — one layout. The simulated strip paints the permanent header and a
// row per account across all three providers; there is no layout switcher, and a
// layout name left in storage by the prototype round changes nothing.

import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { UsageStrip } from '../../UsageStrip';

/** The key the retired variant host persisted its choice under. */
const RETIRED_VARIANT_KEY = 'monitor.usage.variant';

beforeEach(() => { localStorage.clear(); });

function shape() {
  return {
    rows: screen.getAllByTestId('fleet-usage-account').map((r) => `${r.getAttribute('data-provider')}:${r.getAttribute('data-account')}`),
    empty: screen.getAllByTestId('fleet-usage-empty').map((r) => r.getAttribute('data-provider')),
  };
}

describe('UsageStrip', () => {
  it('paints the header and one row per account: five Claude plans, Codex, and a worded Grok', () => {
    render(<UsageStrip simulated />);
    const { rows, empty } = shape();
    expect(rows).toEqual([
      'claude:sim-plan-1', 'claude:sim-plan-2', 'claude:sim-plan-3', 'claude:sim-plan-4', 'claude:sim-plan-5', 'codex:codex',
    ]);
    expect(empty).toEqual(['grok']);
    expect(screen.getByTestId('fleet-usage-plan-count')).toHaveTextContent('5/5');
    expect(screen.getByTestId('fleet-usage-controls')).toBeInTheDocument();
    expect(screen.getByTestId('fleet-usage-refresh')).toBeInTheDocument();
  });

  it('has no layout switcher and no variant body', () => {
    render(<UsageStrip simulated />);
    expect(screen.queryByRole('tablist')).toBeNull();
    expect(screen.queryByRole('tab')).toBeNull();
    expect(screen.queryByRole('tabpanel')).toBeNull();
    expect(screen.queryByTestId('fleet-budgets')).toBeNull();
  });

  it.each(['ledger', 'cockpit', 'lanes', 'horizon', 'classic', 'nonsense'])(
    'ignores a stale stored variant (%s): same rows, same markup, value untouched',
    (stale) => {
      const first = render(<UsageStrip simulated />);
      const clean = shape();
      first.unmount();

      localStorage.setItem(RETIRED_VARIANT_KEY, stale);
      render(<UsageStrip simulated />);
      const after = shape();
      expect(after.rows).toEqual(clean.rows);
      expect(after.empty).toEqual(clean.empty);
      expect(screen.queryByRole('tab')).toBeNull();
      // Inert both ways: nothing reads it, nothing rewrites it.
      expect(localStorage.getItem(RETIRED_VARIANT_KEY)).toBe(stale);
    },
  );
});
