/**
 * chipMeta — the strip's eight chips: their order, their glyph, their name and
 * the one line that says what each one holds.
 *
 * Order is `DECISION_CHIPS` then `ready`, and nothing re-sorts it: the strip,
 * the peek's ←/→ walk and the tests all read {@link HUB_CHIPS}.
 *
 * Glyphs are R2-C "Aurora Deck"'s (the operator's pick, decision-center wave
 * 3), so a chip and the deck card it opens wear the same mark.
 */
import type { LucideIcon } from 'lucide-react';
import {
  FileText,
  Landmark,
  Lightbulb,
  MessagesSquare,
  Rocket,
  ShieldCheck,
  Siren,
  Vote,
} from 'lucide-react';

import type { Translations } from '@/i18n/generated/types';

import { DECISION_CHIPS, type ChipCount, type DecisionChip, type HubChip } from '../model/decisionModel';
import { URGENCY } from '../deck/deckMeta';

/** Every chip, in strip order: the seven decisions, then `ready`. */
export const HUB_CHIPS: readonly HubChip[] = [...DECISION_CHIPS, 'ready'];

export const CHIP_ICON: Record<HubChip, LucideIcon> = {
  gates: ShieldCheck,
  proposals: Vote,
  backlog: Lightbulb,
  incidents: Siren,
  council: Landmark,
  reports: FileText,
  chat: MessagesSquare,
  ready: Rocket,
};

/** The chip's full name, from `t.monitor.dc_hub_chip_*`. */
export function chipLabel(m: Translations['monitor'], chip: HubChip): string {
  switch (chip) {
    case 'gates': return m.dc_hub_chip_gates;
    case 'proposals': return m.dc_hub_chip_proposals;
    case 'backlog': return m.dc_hub_chip_backlog;
    case 'incidents': return m.dc_hub_chip_incidents;
    case 'council': return m.dc_hub_chip_council;
    case 'reports': return m.dc_hub_chip_reports;
    case 'chat': return m.dc_hub_chip_chat;
    case 'ready': return m.dc_hub_chip_ready;
  }
}

/** What the chip holds, one line, from `t.monitor.dc_hub_hint_*`. */
export function chipHint(m: Translations['monitor'], chip: HubChip): string {
  switch (chip) {
    case 'gates': return m.dc_hub_hint_gates;
    case 'proposals': return m.dc_hub_hint_proposals;
    case 'backlog': return m.dc_hub_hint_backlog;
    case 'incidents': return m.dc_hub_hint_incidents;
    case 'council': return m.dc_hub_hint_council;
    case 'reports': return m.dc_hub_hint_reports;
    case 'chat': return m.dc_hub_hint_chat;
    case 'ready': return m.dc_hub_hint_ready;
  }
}

/** The chip `step` places away from `chip`, wrapping. */
export function walkChip(chip: HubChip, step: 1 | -1): HubChip {
  const i = HUB_CHIPS.indexOf(chip);
  return HUB_CHIPS[(i + step + HUB_CHIPS.length) % HUB_CHIPS.length]!;
}

/**
 * The chip the eye should land on first: the most urgent decision chip that
 * answered with something, ties going to strip order. Counts only — the hub
 * never loads every chip's items just to find the roster's first one, and the
 * lamp is the same urgency `compareDecision` orders by.
 */
export function leadChip(counts: Record<HubChip, ChipCount>): DecisionChip | null {
  let best: DecisionChip | null = null;
  let rank = 0;
  for (const chip of DECISION_CHIPS) {
    const c = counts[chip];
    if (c.failed || c.n === 0) continue;
    const r = URGENCY[c.lamp] + 1;
    if (r > rank) {
      best = chip;
      rank = r;
    }
  }
  return best;
}
