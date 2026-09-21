// UsageStrip as the variant host: classic is the default and renders the five
// plan cards it always did; picking a tab swaps the body for the lazy variant,
// declares the tab panel, and remembers the choice for the next mount.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

vi.mock('@/api/system/settings', () => ({ setAppSetting: vi.fn(), deleteAppSetting: vi.fn() }));
vi.mock('@/hooks/utility/data/useAppSetting', () => ({
  useAppSetting: () => ({ value: 'true', setValue: vi.fn(), save: vi.fn(), loaded: true, saved: false, error: null }),
}));

import { UsageStrip } from '../../UsageStrip';
import { USAGE_VARIANT_KEY } from '../usageVariant';

beforeEach(() => { localStorage.clear(); });

describe('UsageStrip variant host', () => {
  it('opens on classic: the five plan cards, no variant body', () => {
    render(<UsageStrip simulated />);
    expect(screen.getAllByTestId('fleet-usage-account')).toHaveLength(5);
    expect(screen.getByRole('tabpanel')).toHaveAttribute('data-variant', 'classic');
    expect(screen.getAllByRole('tab')).toHaveLength(5);
    expect(screen.queryByTestId('fleet-budgets')).toBeNull();
  });

  it('swaps to a picked variant, labels the panel by its tab, and persists the choice', async () => {
    render(<UsageStrip simulated />);
    fireEvent.click(screen.getByTestId('fleet-usage-variant-ledger'));
    expect(await screen.findByTestId('fleet-usage-ledger')).toBeInTheDocument();
    const panel = screen.getByRole('tabpanel');
    expect(panel).toHaveAttribute('data-variant', 'ledger');
    expect(panel).toHaveAttribute('aria-labelledby', screen.getByTestId('fleet-usage-variant-ledger').id);
    expect(screen.queryByTestId('fleet-usage-account')).toBeNull();
    expect(localStorage.getItem(USAGE_VARIANT_KEY)).toBe('ledger');
    // The auto-rotate controls stay in the header for every variant.
    expect(screen.getByTestId('fleet-usage-controls')).toBeInTheDocument();
  });

  it('reopens on the stored variant', async () => {
    localStorage.setItem(USAGE_VARIANT_KEY, 'cockpit');
    render(<UsageStrip simulated />);
    expect(await screen.findByTestId('fleet-usage-cockpit')).toBeInTheDocument();
    expect(screen.getAllByTestId('fleet-usage-dial').length).toBeGreaterThan(0);
  });
});
