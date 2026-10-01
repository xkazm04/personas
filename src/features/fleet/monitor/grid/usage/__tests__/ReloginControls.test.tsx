// ReloginControls + reloginModel — which acts a dead plan offers in each state.

import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { ReloginControls } from '../ReloginControls';
import { reloginView, reloginReasonLabel, DONE_VISIBLE_MS } from '../reloginModel';
import { buildResourceModel, type PlanModel } from '../useResourceModel';
import { buildSimAccountsSnapshot, buildSimCliUsage } from '../../simulation/simPlans';
import { getActiveTranslations } from '@/i18n/useTranslation';
import type { ReloginReason } from '@/lib/bindings/ReloginReason';
import type { ReloginActs } from '../reloginActs';

const NOW = 1_800_000_000_000;

function plans(): PlanModel[] {
  const snap = buildSimAccountsSnapshot(NOW);
  return buildResourceModel({ accounts: snap, single: null, cli: buildSimCliUsage(NOW), fetchedAt: NOW, now: NOW }).providers[0]!.plans;
}
const plan = (id: string) => plans().find((p) => p.id === id)!;

function acts() {
  return {
    profiles: [],
    relogin: vi.fn(() => Promise.resolve()),
    openSignIn: vi.fn(() => Promise.resolve()),
    saveProfile: vi.fn(() => Promise.resolve()),
    setProfile: vi.fn(() => Promise.resolve()),
    listVaultLogins: vi.fn(() => Promise.resolve([])),
  } satisfies ReloginActs;
}

describe('reloginView', () => {
  it.each([
    ['sim-plan-1', 'none'],
    ['sim-plan-2', 'done'],
    ['sim-plan-5', 'needs_you'],
    ['sim-plan-6', 'running'],
    ['sim-plan-7', 'needs_you'],
  ])('%s is %s', (id, kind) => {
    expect(reloginView(plan(id), NOW).kind).toBe(kind);
  });

  it('a dead plan with no run is idle; a done run decays', () => {
    const dead = { ...plan('sim-plan-5'), relogin: null };
    expect(reloginView(dead, NOW).kind).toBe('idle');
    const old = { ...plan('sim-plan-2'), relogin: { ...plan('sim-plan-2').relogin!, startedAtMs: NOW - DONE_VISIBLE_MS - 1 } };
    expect(reloginView(old, NOW).kind).toBe('none');
  });

  it('has a worded, em-dash-free reason for every variant', () => {
    const t = getActiveTranslations();
    const all: ReloginReason[] = [
      'chrome_missing', 'profile_not_linked', 'profile_cold', 'google_challenge', 'cloudflare_challenge', 'captcha',
      'code_inbox_not_linked', 'code_not_found', 'proton_logged_out', 'proton_second_factor', 'selector_drift',
      'identity_mismatch', 'cli_failed', 'timeout', 'rate_limited', 'busy', 'other',
    ];
    const labels = all.map((r) => reloginReasonLabel(t, r));
    expect(new Set(labels).size).toBe(all.length);
    for (const label of labels) {
      expect(label).toBeTruthy();
      expect(label).not.toMatch(/[–—]/);
    }
  });
});

describe('ReloginControls', () => {
  it('idle: only Re-login', () => {
    render(<ReloginControls view={{ kind: 'idle' }} plan={plan('sim-plan-5')} email="a@b.test" acts={acts()} />);
    expect(screen.getByTestId('fleet-usage-relogin')).toBeEnabled();
    expect(screen.queryByTestId('fleet-usage-open-window')).toBeNull();
  });

  it('running: the Re-login control is busy and disabled, and carries the only spinner', () => {
    const { container } = render(<ReloginControls view={{ kind: 'running', step: 'saving' }} plan={plan('sim-plan-6')} email="a@b.test" acts={acts()} />);
    expect(screen.getByTestId('fleet-usage-relogin')).toBeDisabled();
    expect(container.querySelectorAll('[aria-busy="true"]')).toHaveLength(1);
  });

  it('needs you: both acts, each for the right account and profile', () => {
    const a = acts();
    render(<ReloginControls view={{ kind: 'needs_you', reason: 'captcha' }} plan={plan('sim-plan-5')} email="a@b.test" acts={a} />);
    fireEvent.click(screen.getByTestId('fleet-usage-open-window'));
    fireEvent.click(screen.getByTestId('fleet-usage-relogin'));
    expect(a.openSignIn).toHaveBeenCalledWith('work-chrome');
    expect(a.relogin).toHaveBeenCalledWith('sim-plan-5');
  });

  it('a click on either act does not reach the row', () => {
    const onRow = vi.fn();
    render(<div onClick={onRow}><ReloginControls view={{ kind: 'needs_you', reason: 'captcha' }} plan={plan('sim-plan-5')} email="a@b.test" acts={acts()} /></div>);
    fireEvent.click(screen.getByTestId('fleet-usage-relogin'));
    fireEvent.click(screen.getByTestId('fleet-usage-open-window'));
    expect(onRow).not.toHaveBeenCalled();
  });
});
