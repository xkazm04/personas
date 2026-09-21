// The pure join behind the resource-strip variants. What is pinned here is what
// four layouts rely on without re-deriving: provider order, the two-slot window
// grammar, that a stale / projected CLI read is carried as such, that a provider
// with nothing to meter becomes a REASON and never a plan, and that absent
// budgets are null rather than a block of zeros.

import { describe, it, expect } from 'vitest';
import { buildResourceModel, windowIn, type ResourceInputs } from '../useResourceModel';
import { buildSimAccountsSnapshot, buildSimBudgets, buildSimCliUsage } from '../../simulation/simPlans';
import { pace } from '../../usageModel';

const NOW = 1_800_000_000_000;
const HOUR = 3_600_000;

function inputs(over: Partial<ResourceInputs> = {}): ResourceInputs {
  return {
    accounts: buildSimAccountsSnapshot(NOW),
    single: null,
    cli: buildSimCliUsage(NOW),
    budgets: buildSimBudgets(),
    fetchedAt: NOW - 60_000,
    now: NOW,
    ...over,
  };
}

describe('buildResourceModel', () => {
  it('orders providers claude, codex, grok — whatever order the backend used', () => {
    const cli = buildSimCliUsage(NOW);
    const m = buildResourceModel(inputs({ cli: { providers: [...cli.providers].reverse() } }));
    expect(m.providers.map((p) => p.id)).toEqual(['claude', 'codex', 'grok']);
    expect(m.providers.map((p) => p.readOnly)).toEqual([false, true, true]);
  });

  it('carries the per-model weekly windows on the Claude plan that has them', () => {
    const plan = buildResourceModel(inputs()).providers[0]!.plans[0]!;
    expect(plan.windows.map((w) => w.label)).toEqual(['short', 'long', 'opus', 'sonnet']);
    expect(windowIn(plan, 'opus')?.key).toBe('seven_day_opus');
    expect(windowIn(plan, 'opus')?.usedPct).toBe(62);
    expect(windowIn(plan, 'short')?.windowMinutes).toBe(300);
    expect(windowIn(plan, 'long')?.windowMinutes).toBe(10_080);
  });

  it('reuses usageModel for pace and tone rather than a second implementation', () => {
    const snap = buildSimAccountsSnapshot(NOW);
    const m = buildResourceModel(inputs({ accounts: snap }));
    const source = snap.accounts[1]!.usage[0]!;
    const w = windowIn(m.providers[0]!.plans[1]!, 'short')!;
    expect(w.pace).toBe(pace(source, NOW));
    expect(w.tone).toBe('warning'); // 81% — past 75, under 90
  });

  it('mirrors AccountRows: projected, unreadable and quarantined plans, and which acts each offers', () => {
    const plans = buildResourceModel(inputs()).providers[0]!.plans;
    expect(plans.map((p) => p.state)).toEqual(['ok', 'ok', 'projected', 'unreadable', 'quarantined']);
    expect(plans[2]!.windows.every((w) => w.projected)).toBe(true);
    expect(plans[3]!.windows).toEqual([]);
    expect(plans.map((p) => p.canSwitch)).toEqual([false, true, true, true, false]);
    expect(plans.map((p) => p.canRemove)).toEqual([false, false, false, true, true]);
  });

  it('keeps a stale codex read stale: its own as-of stamp, one weekly window, no invented 5h', () => {
    const codex = buildResourceModel(inputs()).providers[1]!;
    expect(codex.asOfMs).toBe(NOW - 3 * HOUR);
    expect(codex.emptyReason).toBeNull();
    const plan = codex.plans[0]!;
    expect(plan.name).toBe('pro');
    expect(plan.windows.map((w) => w.label)).toEqual(['long']);
    expect(windowIn(plan, 'short')).toBeNull();
    expect(plan.windows[0]!.asOfMs).toBe(NOW - 3 * HOUR);
    expect(plan.canSwitch || plan.canRemove).toBe(false);
  });

  it('marks a codex read that rolled past a reset as projected, on the provider and on each window', () => {
    const cli = buildSimCliUsage(NOW);
    cli.providers[0] = { ...cli.providers[0]!, projected: true };
    const codex = buildResourceModel(inputs({ cli })).providers[1]!;
    expect(codex.projected).toBe(true);
    expect(codex.plans[0]!.state).toBe('projected');
    expect(codex.plans[0]!.windows[0]!.projected).toBe(true);
  });

  it('turns an empty grok into a reason, never a plan', () => {
    const grok = buildResourceModel(inputs()).providers[2]!;
    expect(grok.plans).toEqual([]);
    expect(grok.emptyReason).toBe('not_installed');
    expect(grok.pending).toBe(false);
  });

  it('is pending (not "unreadable") for the CLIs until their read settles', () => {
    const m = buildResourceModel(inputs({ cli: null }));
    expect(m.providers[1]!.pending).toBe(true);
    expect(m.providers[1]!.emptyReason).toBeNull();
  });

  it('calls a provider the backend did not mention unreadable', () => {
    const m = buildResourceModel(inputs({ cli: { providers: [] } }));
    expect(m.providers[2]!.emptyReason).toBe('unreadable');
  });

  it('maps undefined and null budgets to null', () => {
    expect(buildResourceModel(inputs({ budgets: undefined })).budgets).toBeNull();
    expect(buildResourceModel(inputs({ budgets: null })).budgets).toBeNull();
  });

  it('derives clamped fractions and the throttle flag from present budgets', () => {
    const b = buildResourceModel(inputs()).budgets!;
    expect(b.machineFrac).toBeCloseTo(0.6);
    expect(b.planFrac).toBeCloseTo(11 / 12);
    expect(b.planCeilingFrac).toBeCloseTo(0.6);
    expect(b.throttled).toBe(true);
    expect(b.hold).toBe('ahead_of_pace');
    const zero = buildResourceModel(inputs({ budgets: { ...buildSimBudgets(), machineBudget: 0, machineUsed: 3 } })).budgets!;
    expect(zero.machineFrac).toBe(0);
  });

  it('falls back to the single-login read while nothing is stored, and to a worded card when that failed', () => {
    const empty = { ...buildSimAccountsSnapshot(NOW), accounts: [] };
    const single = {
      available: true, reason: null, subscriptionType: 'max', rateLimitTier: null, fetchedAtMs: NOW,
      windows: [{ key: 'five_hour', utilizationPct: 12, resetsAtMs: NOW + HOUR, windowMs: 5 * HOUR }],
    };
    const one = buildResourceModel(inputs({ accounts: empty, single })).providers[0]!;
    expect(one.plans).toHaveLength(1);
    expect(one.plans[0]!.isActive).toBe(true);
    expect(one.plans[0]!.name).toBe(empty.liveEmail);

    const cold = buildResourceModel(inputs({ accounts: null, single: null })).providers[0]!;
    expect(cold.pending).toBe(true);
    const failed = buildResourceModel(inputs({ accounts: null, single: null, claudeFailed: true })).providers[0]!;
    expect(failed.pending).toBe(false);
    expect(failed.plans[0]!.state).toBe('unreadable');
    expect(failed.plans[0]!.reason).toBe('ipc');
  });
});
