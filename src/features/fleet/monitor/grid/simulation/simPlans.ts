// simPlans — five Claude logins (and two other CLIs) for the usage strip's rows.
//
// The strip has more branches than any other part of this surface, and all of
// them are invisible on a machine with one login. The fixture covers every
// branch an `AccountRows` row can take:
//
//   slot 1 — the ACTIVE plan, both windows read live, comfortably under pace;
//   slot 2 — a healthy standby, high 5-hour utilisation (percent in warning);
//   slot 3 — a PROJECTED read (`usageProjectedFromMs`): "≈" percents and a
//            half-strength bottom border;
//   slot 4 — a plan the endpoint refused (`usageReason`, no projection) —
//            the unreadable branch, which is the only one that offers Forget;
//   slot 5 — a QUARANTINED plan (dead refresh token): says "Needs login" in
//            words, and offers no switch.
//
// The auto-rotate row and a last-rotation stamp come along with it, because
// `UsageStrip` renders its auto-rotate controls only in multi-plan mode and they,
// too, are unreachable with a single login.

import type { ClaudeAccountsSnapshot } from '@/lib/bindings/ClaudeAccountsSnapshot';
import type { ClaudeAccountView } from '@/lib/bindings/ClaudeAccountView';
import type { ClaudeUsageWindow } from '@/lib/bindings/ClaudeUsageWindow';
import type { CliUsageSnapshot } from '@/lib/bindings/CliUsageSnapshot';

const HOUR_MS = 3_600_000;
const FIVE_HOUR_MS = 5 * HOUR_MS;
const SEVEN_DAY_MS = 7 * 24 * HOUR_MS;

/**
 * The windows are anchored to `now` at BUILD TIME rather than to a fixed
 * instant: the meters' markers and countdowns are read against the wall clock,
 * and a fixture pinned to January would paint five fully-elapsed windows with
 * "<1h" on every row. Determinism here means the same SHAPE, not the same
 * millisecond.
 */
function windows(now: number, fivePct: number, sevenPct: number, fiveLeftMs: number): ClaudeUsageWindow[] {
  return [
    { key: 'five_hour', utilizationPct: fivePct, resetsAtMs: now + fiveLeftMs, windowMs: FIVE_HOUR_MS },
    { key: 'seven_day', utilizationPct: sevenPct, resetsAtMs: now + 3.5 * 24 * HOUR_MS, windowMs: SEVEN_DAY_MS },
  ];
}

function account(view: Partial<ClaudeAccountView> & Pick<ClaudeAccountView, 'id' | 'email' | 'slot'>): ClaudeAccountView {
  return {
    displayName: null,
    organizationName: null,
    rateLimitTier: 'max_20x',
    isActive: false,
    quarantineReason: null,
    tokenExpiresAtMs: null,
    usage: [],
    usageReason: null,
    usageFetchedAtMs: null,
    usageProjectedFromMs: null,
    lastSwitchedAtMs: null,
    ...view,
  };
}

/** The five plans, in slot order. */
export function buildSimAccounts(now = Date.now()): ClaudeAccountView[] {
  return [
    account({
      id: 'sim-plan-1', email: 'fleet.one@simulated.test', slot: 1, isActive: true,
      displayName: 'Fleet primary',
      // The live plan also carries the per-model weekly windows, as a real Max
      // plan does: the row must keep painting the ALL-MODELS weekly window as its
      // 7-day cluster and border, not whichever weekly window happens to come last.
      usage: [
        ...windows(now, 34, 41, 2.2 * HOUR_MS),
        { key: 'seven_day_opus', utilizationPct: 62, resetsAtMs: now + 3.5 * 24 * HOUR_MS, windowMs: SEVEN_DAY_MS },
        { key: 'seven_day_sonnet', utilizationPct: 18, resetsAtMs: now + 3.5 * 24 * HOUR_MS, windowMs: SEVEN_DAY_MS },
      ],
      usageFetchedAtMs: now - 90_000,
      lastSwitchedAtMs: now - 4 * HOUR_MS,
    }),
    account({
      id: 'sim-plan-2', email: 'fleet.two@simulated.test', slot: 2,
      usage: windows(now, 81, 63, 1.1 * HOUR_MS),
      usageFetchedAtMs: now - 120_000,
    }),
    account({
      id: 'sim-plan-3', email: 'fleet.three@simulated.test', slot: 3,
      usage: windows(now, 58, 22, 3.4 * HOUR_MS),
      usageProjectedFromMs: now - 46 * 60_000,
      usageFetchedAtMs: now - 46 * 60_000,
    }),
    account({
      id: 'sim-plan-4', email: 'fleet.four@simulated.test', slot: 4,
      usageReason: 'oauth',
      usageFetchedAtMs: now - 300_000,
    }),
    account({
      id: 'sim-plan-5', email: 'fleet.five@simulated.test', slot: 5,
      quarantineReason: 'refresh_failed',
      usageReason: 'oauth',
      usageFetchedAtMs: now - 600_000,
    }),
  ];
}

export function buildSimAccountsSnapshot(now = Date.now()): ClaudeAccountsSnapshot {
  const accounts = buildSimAccounts(now);
  return {
    activeAccountId: accounts[0]!.id,
    liveEmail: accounts[0]!.email,
    liveCaptured: true,
    livePresent: true,
    accounts,
    autoRotate: { enabled: true, thresholdPct: 80, cooldownSecs: 900 },
    lastRotation: {
      atMs: now - 37 * 60_000,
      fromEmail: 'fleet.two@simulated.test',
      toEmail: 'fleet.one@simulated.test',
      reason: 'five_hour:84',
    },
  };
}

/**
 * Make `id` the live plan, exactly as a real switch would report it back.
 * The strip's switch confirm stays wired in simulation so the flow can be
 * walked end to end; what changes is only where the new snapshot comes from.
 */
export function simSwitchActive(snapshot: ClaudeAccountsSnapshot, id: string): ClaudeAccountsSnapshot {
  const target = snapshot.accounts.find((a) => a.id === id);
  if (!target || target.quarantineReason !== null) return snapshot;
  return {
    ...snapshot,
    activeAccountId: id,
    liveEmail: target.email,
    accounts: snapshot.accounts.map((a) => ({
      ...a,
      isActive: a.id === id,
      lastSwitchedAtMs: a.id === id ? Date.now() : a.lastSwitchedAtMs,
    })),
  };
}

/** Forget a plan. Slots are NOT renumbered — the real backend does not either. */
export function simRemoveAccount(snapshot: ClaudeAccountsSnapshot, id: string): ClaudeAccountsSnapshot {
  return { ...snapshot, accounts: snapshot.accounts.filter((a) => a.id !== id) };
}

// ── The other CLIs ───────────────────────────────────────────────────────────
//
// The strip gives Codex and Grok a row each, and on a development machine
// neither is likely to be installed. So the fixture carries one of each honest
// state:
//
//   codex — installed, plan `pro`, ONE window (the 7-day `primary`), last
//           reported three hours ago: the row's 5-hour cluster has to cope with
//           a provider that has none;
//   grok  — not installed: the worded empty row, never a meter.

export function buildSimCliUsage(now = Date.now()): CliUsageSnapshot {
  return {
    providers: [
      {
        provider: 'codex',
        installed: true,
        version: '0.41.0',
        planType: 'pro',
        windows: [
          { key: 'primary', windowMinutes: 10_080, usedPercent: 47, resetsAtMs: now + 2.25 * 24 * HOUR_MS },
        ],
        asOfMs: now - 3 * HOUR_MS,
        projected: false,
        reason: null,
      },
      {
        provider: 'grok',
        installed: false,
        version: null,
        planType: null,
        windows: [],
        asOfMs: null,
        projected: false,
        reason: 'not_installed',
      },
    ],
  };
}
