// useResourceModel — everything the usage strip knows, joined into ONE shape.
//
// Two reads feed the strip and they arrive in two vocabularies: the Claude plans
// (`ClaudeAccountsSnapshot`, or the single-login `ClaudeUsageSnapshot` while
// nothing is stored) and the other CLIs (`CliUsageSnapshot`, windows keyed
// primary/secondary and measured in minutes). The strip paints one row grammar
// for all of them, and a row that re-derives "which window is the weekly one" per
// provider is a row that will disagree with its neighbour. So the join happens
// once, here, as a pure function of its inputs and `now` — `AccountRows` only
// lays out what it returns.
//
// THE ARITHMETIC IS NOT HERE. Pace, tone and elapsed fraction are `usageModel`'s
// (`pace`, `meterTone`, `windowProgress`); a CLI window is converted into the
// shape those functions take rather than given a second implementation.
//
// WORDS ARE NOT HERE EITHER. `label` is the window's SLOT in the strip's
// two-window grammar (`short` = the hours-scale session window, `long` = the
// weekly one, plus Claude's per-model weekly `opus` / `sonnet`, which the row
// does not paint); the row turns a slot into an icon and a sentence. Every
// provider is described by the same slots, which is what lets one row serve all
// three.

import { useMemo } from 'react';
import type { ClaudeAccountsSnapshot } from '@/lib/bindings/ClaudeAccountsSnapshot';
import type { ClaudeAccountView } from '@/lib/bindings/ClaudeAccountView';
import type { ClaudeUsageSnapshot } from '@/lib/bindings/ClaudeUsageSnapshot';
import type { ClaudeUsageWindow } from '@/lib/bindings/ClaudeUsageWindow';
import type { CliProvider } from '@/lib/bindings/CliProvider';
import type { CliProviderUsage } from '@/lib/bindings/CliProviderUsage';
import type { CliUsageReason } from '@/lib/bindings/CliUsageReason';
import type { CliUsageSnapshot } from '@/lib/bindings/CliUsageSnapshot';
import { meterTone, orderWindows, pace, windowProgress, type MeterTone, type Pace } from '../usageModel';
import { CLI_PROVIDERS } from './cliProviders';

export type ProviderId = 'claude' | CliProvider;
export type WindowSlot = 'short' | 'long' | 'opus' | 'sonnet';

/** A window at or under a day is the session-scale one; anything longer is weekly-scale. */
const SHORT_WINDOW_MAX_MINUTES = 24 * 60;

export interface WindowModel {
  /** The source's own key (`five_hour`, `seven_day_opus`, `primary`, …). */
  key: string;
  /** The slot in the strip's shared grammar — see the header. */
  label: WindowSlot;
  usedPct: number;
  resetsAtMs: number | null;
  windowMinutes: number;
  pace: Pace | null;
  /** The figure is carried forward / rolled past a reset, not read. */
  projected: boolean;
  /** When the figure was true, epoch ms. */
  asOfMs: number | null;
  tone: MeterTone;
  /** 0–1 of the window already elapsed at `now`; null without a reset. */
  elapsedFrac: number | null;
  remainingMs: number | null;
}

export type PlanState = 'ok' | 'projected' | 'unreadable' | 'quarantined';

export interface PlanModel {
  id: string;
  /** Email (Claude) or plan type (CLI); null when the source named neither. */
  name: string | null;
  slot: number | null;
  isActive: boolean;
  state: PlanState;
  /** Machine reason in the `fleet_claude_usage` vocabulary, when unreadable. */
  reason: string | null;
  windows: WindowModel[];
  asOfMs: number | null;
  /** Claude only: the plan is not live and not quarantined / nothing could be read for it. */
  canSwitch: boolean;
  canRemove: boolean;
}

export interface ProviderModel {
  id: ProviderId;
  /** Codex and Grok are observed, never driven. */
  readOnly: boolean;
  installed: boolean;
  version: string | null;
  /** Why there is nothing to meter — a CLI provider with no plans always has one. */
  emptyReason: CliUsageReason | null;
  /** The read that feeds this provider has not settled yet. */
  pending: boolean;
  plans: PlanModel[];
  asOfMs: number | null;
  projected: boolean;
}

export interface ResourceModel {
  /** Always claude, codex, grok — in that order. */
  providers: ProviderModel[];
}

export interface ResourceInputs {
  accounts: ClaudeAccountsSnapshot | null;
  /** The single-login read, used only while no plan is stored. */
  single: ClaudeUsageSnapshot | null;
  cli: CliUsageSnapshot | null;
  /** When the Claude read was taken, epoch ms. */
  fetchedAt: number | null;
  /** The Claude IPC itself rejected and nothing is remembered — a worded card, not an endless ghost. */
  claudeFailed?: boolean;
  now: number;
}

const CLAUDE_SLOTS: Record<string, WindowSlot> = {
  five_hour: 'short',
  seven_day: 'long',
  seven_day_opus: 'opus',
  seven_day_sonnet: 'sonnet',
};

function windowModel(
  w: ClaudeUsageWindow, label: WindowSlot, now: number, projected: boolean, asOfMs: number | null,
): WindowModel {
  const { elapsedFrac, remainingMs } = windowProgress(w, now);
  return {
    key: w.key,
    label,
    usedPct: Math.min(100, Math.max(0, w.utilizationPct)),
    resetsAtMs: w.resetsAtMs,
    windowMinutes: Math.round(w.windowMs / 60_000),
    pace: pace(w, now),
    projected,
    asOfMs,
    tone: meterTone(w.utilizationPct),
    elapsedFrac,
    remainingMs,
  };
}

function claudeWindows(
  usage: readonly ClaudeUsageWindow[], now: number, projected: boolean, asOfMs: number | null,
): WindowModel[] {
  const out: WindowModel[] = [];
  for (const w of orderWindows(usage)) {
    const label = CLAUDE_SLOTS[w.key];
    if (label) out.push(windowModel(w, label, now, projected, asOfMs));
  }
  return out;
}

function claudePlan(a: ClaudeAccountView, now: number): PlanModel {
  const quarantined = a.quarantineReason !== null;
  const projected = a.usageProjectedFromMs !== null && a.usage.length > 0;
  const unreadable = (quarantined || a.usageReason !== null) && !projected;
  const state: PlanState = unreadable ? (quarantined ? 'quarantined' : 'unreadable') : projected ? 'projected' : 'ok';
  const asOfMs = projected ? a.usageProjectedFromMs : a.usageFetchedAtMs;
  return {
    id: a.id,
    name: a.email,
    slot: a.slot,
    isActive: a.isActive,
    state,
    reason: unreadable ? a.usageReason : null,
    windows: unreadable ? [] : claudeWindows(a.usage, now, projected, asOfMs),
    asOfMs,
    canSwitch: !a.isActive && !quarantined,
    canRemove: unreadable && !a.isActive,
  };
}

function claudeProvider(inputs: ResourceInputs): ProviderModel {
  const { accounts, single, fetchedAt, now } = inputs;
  const stored = accounts?.accounts ?? [];
  let plans: PlanModel[] = [];
  if (stored.length > 0) {
    plans = stored.map((a) => claudePlan(a, now));
  } else if (single) {
    plans = [{
      id: 'live',
      name: accounts?.liveEmail ?? null,
      slot: null,
      isActive: true,
      state: single.available ? 'ok' : 'unreadable',
      reason: single.available ? null : single.reason,
      windows: single.available ? claudeWindows(single.windows, now, false, single.fetchedAtMs) : [],
      asOfMs: single.fetchedAtMs,
      canSwitch: false,
      canRemove: false,
    }];
  } else if (inputs.claudeFailed) {
    plans = [{
      id: 'live', name: accounts?.liveEmail ?? null, slot: null, isActive: true, state: 'unreadable',
      reason: 'ipc', windows: [], asOfMs: null, canSwitch: false, canRemove: false,
    }];
  }
  return {
    id: 'claude',
    readOnly: false,
    installed: true,
    version: null,
    emptyReason: null,
    pending: plans.length === 0,
    plans,
    asOfMs: fetchedAt,
    projected: plans.some((p) => p.state === 'projected'),
  };
}

function cliProvider(id: CliProvider, usage: CliProviderUsage | undefined, settled: boolean, now: number): ProviderModel {
  const base = {
    id, readOnly: true, version: usage?.version ?? null, asOfMs: usage?.asOfMs ?? null,
    projected: usage?.projected ?? false, installed: usage?.installed ?? false,
  };
  if (!settled) return { ...base, emptyReason: null, pending: true, plans: [] };
  if (!usage || usage.windows.length === 0) {
    // Nothing to meter is ALWAYS a worded state — never a zeroed meter.
    return { ...base, emptyReason: usage?.reason ?? 'unreadable', pending: false, plans: [] };
  }
  const windows = [...usage.windows]
    .sort((a, b) => a.windowMinutes - b.windowMinutes)
    .map((w) => windowModel(
      { key: w.key, utilizationPct: w.usedPercent, resetsAtMs: w.resetsAtMs, windowMs: w.windowMinutes * 60_000 },
      w.windowMinutes <= SHORT_WINDOW_MAX_MINUTES ? 'short' : 'long',
      now, usage.projected, usage.asOfMs,
    ));
  return {
    ...base,
    emptyReason: null,
    pending: false,
    plans: [{
      id,
      name: usage.planType,
      slot: null,
      isActive: false,
      state: usage.projected ? 'projected' : 'ok',
      reason: null,
      windows,
      asOfMs: usage.asOfMs,
      canSwitch: false,
      canRemove: false,
    }],
  };
}

/** The pure join. Same inputs, same `now` → same model. */
export function buildResourceModel(inputs: ResourceInputs): ResourceModel {
  const { cli, now } = inputs;
  return {
    providers: [
      claudeProvider(inputs),
      ...CLI_PROVIDERS.map((id) => cliProvider(id, cli?.providers.find((p) => p.provider === id), cli !== null, now)),
    ],
  };
}

/** The window filling `slot` on a plan, if it has one. */
export function windowIn(plan: PlanModel, slot: WindowSlot): WindowModel | null {
  for (const w of plan.windows) if (w.label === slot) return w;
  return null;
}

export function useResourceModel(inputs: ResourceInputs): ResourceModel {
  const { accounts, single, cli, fetchedAt, claudeFailed, now } = inputs;
  return useMemo(
    () => buildResourceModel({ accounts, single, cli, fetchedAt, claudeFailed, now }),
    [accounts, single, cli, fetchedAt, claudeFailed, now],
  );
}
