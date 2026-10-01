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
//   slot 5 — a QUARANTINED plan (dead refresh token) whose last re-login stopped
//            at NEEDS YOU / profile_cold: the reason in words, Re-login and Open
//            sign-in window, and no switch;
//   slot 6 — a quarantined plan with a re-login RUNNING (waiting for the code);
//   slot 7 — a quarantined plan at NEEDS YOU / proton_second_factor;
//   slot 2 also carries a DONE re-login ("Signed in again", which decays).
//
// The auto-rotate row and a last-rotation stamp come along with it, because
// `UsageStrip` renders its auto-rotate controls only in multi-plan mode and they,
// too, are unreachable with a single login.

import type { ClaudeAccountsSnapshot } from '@/lib/bindings/ClaudeAccountsSnapshot';
import type { ClaudeAccountView } from '@/lib/bindings/ClaudeAccountView';
import type { ClaudeUsageWindow } from '@/lib/bindings/ClaudeUsageWindow';
import type { CliUsageSnapshot } from '@/lib/bindings/CliUsageSnapshot';
import type { LoginProfileView } from '@/lib/bindings/LoginProfileView';
import type { ReloginReason } from '@/lib/bindings/ReloginReason';
import type { ReloginState } from '@/lib/bindings/ReloginState';

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
    login: null,
    relogin: null,
    ...view,
  };
}

function relogin(
  accountId: string, now: number, phase: ReloginState['phase'],
  extra: Partial<Pick<ReloginState, 'step' | 'reason'>> = {},
): ReloginState {
  return { accountId, phase, step: null, reason: null, trigger: 'manual', startedAtMs: now - 20_000, ...extra };
}

/** The browser profiles the simulated plans are linked to. */
export function buildSimProfiles(now = Date.now()): LoginProfileView[] {
  return [
    { key: 'work-chrome', label: 'Work Chrome', vaultCredentialId: null, lastWarmAtMs: now - 3 * HOUR_MS, lastResult: 'ok' },
    { key: 'proton-inbox', label: 'Proton inbox', vaultCredentialId: 'sim-vault-proton', lastWarmAtMs: now - 26 * HOUR_MS, lastResult: 'ok' },
  ];
}

/** The simulated vault logins the settings dialog can bind to a Proton profile. */
export const SIM_VAULT_LOGINS = [
  { id: 'sim-vault-proton', name: 'Proton mailbox (simulated)' },
  { id: 'sim-vault-other', name: 'Second mailbox (simulated)' },
];

/** The seven plans, in slot order. */
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
      login: { profileKey: 'work-chrome', codeInboxProfileKey: null, reloginUnattended: false },
      relogin: relogin('sim-plan-2', now, 'done'),
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
      login: { profileKey: 'work-chrome', codeInboxProfileKey: null, reloginUnattended: false },
      relogin: relogin('sim-plan-5', now, 'needs_you', { reason: 'profile_cold' }),
    }),
    account({
      id: 'sim-plan-6', email: 'fleet.six@simulated.test', slot: 6,
      quarantineReason: 'refresh_failed',
      usageReason: 'oauth',
      usageFetchedAtMs: now - 700_000,
      login: { profileKey: 'work-chrome', codeInboxProfileKey: 'proton-inbox', reloginUnattended: true },
      relogin: relogin('sim-plan-6', now, 'running', { step: 'waiting_for_code' }),
    }),
    account({
      id: 'sim-plan-7', email: 'fleet.seven@simulated.test', slot: 7,
      quarantineReason: 'invalid_grant',
      usageReason: 'oauth',
      usageFetchedAtMs: now - 800_000,
      login: { profileKey: 'work-chrome', codeInboxProfileKey: 'proton-inbox', reloginUnattended: false },
      relogin: relogin('sim-plan-7', now, 'needs_you', { reason: 'proton_second_factor' }),
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
    profiles: buildSimProfiles(now),
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

/**
 * A simulated re-login, resolved the way a real one would end for the account's
 * link: a plan with a linked profile comes back ("Signed in again", usage read
 * again); one with none stops at needs-you / `profile_not_linked`. No timers: the
 * run ends in the same call, so a click is always answered.
 */
export function simRelogin(snapshot: ClaudeAccountsSnapshot, id: string, now = Date.now()): ClaudeAccountsSnapshot {
  const linked = snapshot.accounts.find((a) => a.id === id)?.login?.profileKey != null;
  const reason: ReloginReason = 'profile_not_linked';
  return {
    ...snapshot,
    accounts: snapshot.accounts.map((a) => {
      if (a.id !== id) return a;
      if (!linked) return { ...a, relogin: { ...relogin(id, now, 'needs_you', { reason }), startedAtMs: now } };
      return {
        ...a,
        quarantineReason: null,
        usageReason: null,
        usage: windows(now, 9, 14, 4 * HOUR_MS),
        usageFetchedAtMs: now,
        relogin: { ...relogin(id, now, 'done'), startedAtMs: now },
      };
    }),
  };
}

/** Link a plan to its profiles, as `fleet_claude_account_profile_set` would. */
export function simSetProfile(
  snapshot: ClaudeAccountsSnapshot, id: string, profileKey: string | null, codeInboxProfileKey: string | null,
  reloginUnattended: boolean,
): ClaudeAccountsSnapshot {
  return {
    ...snapshot,
    accounts: snapshot.accounts.map((a) =>
      a.id === id ? { ...a, login: { profileKey, codeInboxProfileKey, reloginUnattended } } : a),
  };
}

/** Create or update a profile, as `fleet_claude_profile_save` would. */
export function simSaveProfile(
  snapshot: ClaudeAccountsSnapshot, key: string, label: string, vaultCredentialId: string | null,
): ClaudeAccountsSnapshot {
  const next: LoginProfileView = { key, label, vaultCredentialId, lastWarmAtMs: null, lastResult: null };
  const exists = snapshot.profiles.some((p) => p.key === key);
  return {
    ...snapshot,
    profiles: exists ? snapshot.profiles.map((p) => (p.key === key ? { ...p, label, vaultCredentialId } : p)) : [...snapshot.profiles, next],
  };
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
