/**
 * P1 meta: chip glyphs, tone -> token classes, and the small pure readings the
 * three levels share (an item's urgency tone, what it costs, which queue a
 * scope walks). React-free.
 */
import type { LucideIcon } from 'lucide-react';
import {
  FileText, Flame, Landmark, Lightbulb, MessageSquare, Rocket, ShieldCheck, SlidersHorizontal,
} from 'lucide-react';
import type { TriageTone } from '@/features/agents/quick-answer/triage/triageTypes';
import {
  chipOf, modalTypeOf,
  type DecisionItem, type DecisionModalType, type HubChip,
} from '../../../model/decisionModel';
import { COPY } from './copy';

export const CHIP_ICON: Record<HubChip, LucideIcon> = {
  gates: ShieldCheck,
  proposals: SlidersHorizontal,
  backlog: Lightbulb,
  incidents: Flame,
  council: Landmark,
  reports: FileText,
  chat: MessageSquare,
  ready: Rocket,
};

/** Text ink per tone — status tokens only. */
export const TONE_TEXT: Record<TriageTone, string> = {
  neutral: 'text-foreground',
  accent: 'text-primary',
  success: 'text-status-success',
  warning: 'text-status-warning',
  danger: 'text-status-error',
};

/** The chip recipe: hairline + tint + ink. */
export const TONE_CHIP: Record<TriageTone, string> = {
  neutral: 'border-primary/15 bg-secondary/40 text-foreground',
  accent: 'border-primary/30 bg-primary/10 text-primary',
  success: 'border-status-success/30 bg-status-success/10 text-status-success',
  warning: 'border-status-warning/30 bg-status-warning/10 text-status-warning',
  danger: 'border-status-error/30 bg-status-error/10 text-status-error',
};

/** A lamp/bar fill. */
export const TONE_FILL: Record<TriageTone, string> = {
  neutral: 'bg-foreground/30',
  accent: 'bg-primary',
  success: 'bg-status-success',
  warning: 'bg-status-warning',
  danger: 'bg-status-error',
};

const RANK: Record<TriageTone, number> = { danger: 4, warning: 3, accent: 2, success: 1, neutral: 0 };

/** The loudest tone an item carries: alert, then severity tag, then any tag. */
export function urgencyTone(item: DecisionItem): TriageTone {
  if (item.severity === 'critical') return 'danger';
  let best: TriageTone = item.alert?.tone ?? 'neutral';
  for (const tag of item.tags) if (RANK[tag.tone] > RANK[best] && tag.tone !== 'success') best = tag.tone;
  return best;
}

/** What deciding this costs the reader, in one short phrase. */
export function costOf(item: DecisionItem): string {
  if (item.input) return COPY.cost.answers(item.input.fields.length);
  if (item.document) {
    const words = item.document.content.replace(/<[^>]+>/g, ' ').split(/\s+/).filter(Boolean).length;
    return COPY.cost.read(Math.max(1, Math.round(words / 220)));
  }
  if (item.thread) return COPY.cost.reply;
  const effort = item.facts.find((f) => f.id === 'effort');
  if (effort) return COPY.cost.effort(effort.value);
  return COPY.cost.oneKey;
}

/** What one walk covers: a chip's items, the whole roster, or one modal type (Lab entry). */
export type Scope =
  | { kind: 'chip'; chip: HubChip }
  | { kind: 'all' }
  | { kind: 'type'; type: DecisionModalType };

export function queueOf(scope: Scope, items: DecisionItem[], ready: DecisionItem[]): DecisionItem[] {
  if (scope.kind === 'all') return items;
  if (scope.kind === 'type') return items.filter((i) => modalTypeOf(i.kind) === scope.type);
  if (scope.chip === 'ready') return ready;
  return items.filter((i) => chipOf(i.kind) === scope.chip);
}

export function scopeLabel(scope: Scope): string {
  if (scope.kind === 'all') return COPY.sheet.triageAll;
  if (scope.kind === 'chip') return COPY.chip[scope.chip];
  return COPY.typeScope[scope.type];
}

/** Ease-out-expo, the BaseModal curve, so our motion and the host's agree. */
export const EASE_OUT = [0.22, 1, 0.36, 1] as const;

/** True while the user is typing — letter shortcuts must not fire. */
export function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || target.isContentEditable;
}
