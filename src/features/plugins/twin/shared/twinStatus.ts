/**
 * Twin slot status vocabulary — ONE presentation table for the four setup
 * slots shown on the profile card footer and on every Setup/Hub variant.
 *
 * Per the status-vocabulary standard: the chain runs vocabulary → semantic
 * role → themed value, and a call site never reaches past the role. Each
 * entry carries its role, label key AND glyph side by side, so a status is
 * distinguishable by SHAPE as well as colour (colour-blind safe, and legible
 * in both themes). Unknown members fall back to the least-complete member.
 */

import { BookUser, Brain, MessagesSquare, Radio, Sparkles } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import type { MilestoneStatus, TwinReadiness } from '../useTwinReadiness';

/** The four slots the profile-card footer reports, in render order. */
export type TwinSlotId = 'identity' | 'tone' | 'brain' | 'memories';

export const TWIN_SLOT_IDS: readonly TwinSlotId[] = ['identity', 'tone', 'brain', 'memories'] as const;

/** Wire-level status token. Derived from `MilestoneStatus`, never hand-set. */
export type TwinSlotStatus = 'set' | 'partial' | 'empty';

export type TwinStatusRole = 'success' | 'warning' | 'neutral';

interface TwinStatusEntry {
  role: TwinStatusRole;
  /** i18n key under `twin.status`. Never render the raw token. */
  labelKey: 'set' | 'partial' | 'empty';
  /** Semantic classes only — no raw palette at the call site. */
  dot: string;
  text: string;
  ring: string;
  /** Shape carries the same information as colour. */
  shape: 'filled' | 'half' | 'hollow';
}

const STATUS_TABLE: Record<TwinSlotStatus, TwinStatusEntry> = {
  set: {
    role: 'success',
    labelKey: 'set',
    dot: 'bg-status-success',
    text: 'text-status-success',
    ring: 'ring-status-success/40',
    shape: 'filled',
  },
  partial: {
    role: 'warning',
    labelKey: 'partial',
    dot: 'bg-status-warning',
    text: 'text-status-warning',
    ring: 'ring-status-warning/40',
    shape: 'half',
  },
  empty: {
    role: 'neutral',
    labelKey: 'empty',
    dot: 'bg-foreground/25',
    text: 'text-foreground/50',
    ring: 'ring-foreground/15',
    shape: 'hollow',
  },
};

/** Unknown / unmappable members resolve to the least-complete member. */
export function twinStatusEntry(status: TwinSlotStatus | undefined): TwinStatusEntry {
  return STATUS_TABLE[status ?? 'empty'] ?? STATUS_TABLE.empty;
}

/** The single mapping from the readiness milestone vocabulary to this one. */
export function slotStatusOf(milestone: MilestoneStatus | undefined): TwinSlotStatus {
  if (milestone === 'complete') return 'set';
  if (milestone === 'partial') return 'partial';
  return 'empty';
}

interface TwinSlotMeta {
  id: TwinSlotId;
  Icon: LucideIcon;
  /** i18n key under `twin.slots`. */
  labelKey: TwinSlotId;
  /** Where a click on this slot goes. */
  destination: 'setup' | 'hub';
}

export const TWIN_SLOTS: Record<TwinSlotId, TwinSlotMeta> = {
  identity: { id: 'identity', Icon: BookUser, labelKey: 'identity', destination: 'setup' },
  tone: { id: 'tone', Icon: MessagesSquare, labelKey: 'tone', destination: 'setup' },
  brain: { id: 'brain', Icon: Brain, labelKey: 'brain', destination: 'hub' },
  memories: { id: 'memories', Icon: Sparkles, labelKey: 'memories', destination: 'hub' },
};

/* ------------------------------------------------------------------ *
 *  The focus vocabulary, and the ONE join between it and the slots.
 * ------------------------------------------------------------------ */

/**
 * The four questions the guided Setup flow can ask. Same four words as the
 * slots at a glance, but NOT the same set: `channels` is asked in Setup and is
 * not a profile slot, and `brain` is a slot nothing asks a question about.
 *
 * Structurally identical to `SetupFocus` in `setup/setupContract.ts` (which is
 * the contract's own name for it); it is restated here rather than imported so
 * this module stays free of the Setup module — `setupContract` already imports
 * FROM here, and the reverse edge would be a cycle.
 */
export type TwinFocusId = 'identity' | 'tone' | 'channels' | 'memories';

/** One glyph per focus. Matches `TWIN_SLOTS` where the two vocabularies meet. */
export const TWIN_FOCUS_ICON: Record<TwinFocusId, LucideIcon> = {
  identity: BookUser,
  tone: MessagesSquare,
  channels: Radio,
  memories: Sparkles,
};

/**
 * The join, stated once. `null` is the honest answer for `channels`, the one
 * focus with no slot, and is why this cannot be a total `Record<A, B>` — the
 * local copies the variants used to carry were `Partial<>` maps that each
 * spelled the same exception out again.
 */
export const FOCUS_TO_SLOT: Record<TwinFocusId, TwinSlotId | null> = {
  identity: 'identity',
  tone: 'tone',
  channels: null,
  memories: 'memories',
};

/**
 * The Hub slot a focus opens, or `null` when the focus is finished in Setup
 * itself. Derived from `TWIN_SLOTS[...].destination` so a slot that later moves
 * between the two tabs moves here too, in one edit.
 */
export function hubSlotForFocus(focus: TwinFocusId): TwinSlotId | null {
  const slot = FOCUS_TO_SLOT[focus];
  if (!slot) return null;
  return TWIN_SLOTS[slot].destination === 'hub' ? slot : null;
}

/** Read the four footer statuses off a readiness object in one call. */
export function slotStatuses(readiness: TwinReadiness): Record<TwinSlotId, TwinSlotStatus> {
  return {
    identity: slotStatusOf(readiness.identity),
    tone: slotStatusOf(readiness.tone),
    brain: slotStatusOf(readiness.brain),
    memories: slotStatusOf(readiness.memories),
  };
}
