/**
 * chipMeta — the strip's eight chips: their order, their glyph and their name.
 *
 * Order is `DECISION_CHIPS` then `ready`, and nothing re-sorts it: the strip,
 * the peek's ←/→ walk and the tests all read {@link HUB_CHIPS}.
 *
 * Interim slot (decision-center spark, A3): the winning prototype direction
 * replaces the strip's visuals, not this order or these names.
 */
import type { LucideIcon } from 'lucide-react';
import {
  FileText,
  Landmark,
  Lightbulb,
  MessagesSquare,
  Rocket,
  ShieldAlert,
  Siren,
  Sparkles,
} from 'lucide-react';

import type { Translations } from '@/i18n/generated/types';

import { DECISION_CHIPS, type HubChip } from '../model/decisionModel';

/** Every chip, in strip order: the seven decisions, then `ready`. */
export const HUB_CHIPS: readonly HubChip[] = [...DECISION_CHIPS, 'ready'];

export const CHIP_ICON: Record<HubChip, LucideIcon> = {
  gates: ShieldAlert,
  proposals: Sparkles,
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

/** The chip `step` places away from `chip`, wrapping. */
export function walkChip(chip: HubChip, step: 1 | -1): HubChip {
  const i = HUB_CHIPS.indexOf(chip);
  return HUB_CHIPS[(i + step + HUB_CHIPS.length) % HUB_CHIPS.length]!;
}
