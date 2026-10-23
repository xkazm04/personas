// Rotation strategy — the queue badge on a standby row and the strategy control
// in the strip's header. The ORDER itself is the backend's (`rotationRank`); the
// UI must show it and nothing else, and write the chosen strategy back.

import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import type { ClaudeAccountsSnapshot } from '@/lib/bindings/ClaudeAccountsSnapshot';
import { AccountRows } from '../AccountRows';
import { UsageStripControls } from '../UsageStripControls';
import { buildResourceModel } from '../usage/useResourceModel';
import { buildSimAccountsSnapshot, buildSimCliUsage } from '../simulation/simPlans';

const NOW = 1_800_000_000_000;

function snapshot(): ClaudeAccountsSnapshot {
  const base = buildSimAccountsSnapshot(NOW);
  const standby = base.accounts.filter((a) => !a.isActive && a.quarantineReason === null);
  const ranked = new Map(standby.slice(0, 2).map((a, i) => [a.id, i + 1]));
  return {
    ...base,
    accounts: base.accounts.map((a) => ({ ...a, rotationRank: ranked.get(a.id) ?? null })),
  };
}

function rows(accounts: ClaudeAccountsSnapshot) {
  const model = buildResourceModel({ accounts, single: null, cli: buildSimCliUsage(NOW), fetchedAt: NOW, now: NOW });
  const noop = () => Promise.resolve();
  const relogin = {
    profiles: accounts.profiles, relogin: noop, openSignIn: noop, saveProfile: noop, setProfile: noop,
    listVaultLogins: () => Promise.resolve([]),
  };
  render(<AccountRows model={model} onSwitch={noop} onRemove={noop} relogin={relogin} now={NOW} />);
}

describe('rotation queue badge', () => {
  it('marks exactly the ranked standbys, in the backend order, never the live plan', () => {
    const snap = snapshot();
    rows(snap);
    const badges = screen.getAllByTestId('fleet-usage-rotation-rank').map((el) => el.textContent);
    expect(badges).toHaveLength(2);
    expect(badges[0]).toContain('1');
    expect(badges[1]).toContain('2');
    const live = screen.getAllByTestId('fleet-usage-account').find((el) => el.getAttribute('data-active') === 'true')!;
    expect(live.querySelector('[data-testid="fleet-usage-rotation-rank"]')).toBeNull();
  });

  it('shows nothing when no plan is queued (auto-rotate off)', () => {
    const base = buildSimAccountsSnapshot(NOW);
    rows({ ...base, accounts: base.accounts.map((a) => ({ ...a, rotationRank: null })) });
    expect(screen.queryAllByTestId('fleet-usage-rotation-rank')).toHaveLength(0);
  });
});

describe('strategy control', () => {
  it('writes the picked strategy with the current toggle and threshold', () => {
    const snap = snapshot();
    const onSave = vi.fn();
    render(<UsageStripControls snapshot={snap} onSave={onSave} />);
    fireEvent.click(screen.getByTestId('fleet-usage-strategy-coolest'));
    expect(onSave).toHaveBeenCalledWith(snap.autoRotate.enabled, snap.autoRotate.thresholdPct, 'coolest');
  });

  it('does not write when the active strategy is picked again', () => {
    const snap = snapshot();
    const onSave = vi.fn();
    render(<UsageStripControls snapshot={snap} onSave={onSave} />);
    fireEvent.click(screen.getByTestId('fleet-usage-strategy-soonest'));
    expect(onSave).not.toHaveBeenCalled();
  });
});
