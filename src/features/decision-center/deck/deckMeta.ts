/**
 * The deck's static vocabulary: how a kind is drawn and called, which tier an
 * item sits in, what saying yes does, and what an item costs to clear.
 * React-free.
 *
 * Copy is never stored here. Every word resolves at render from
 * `t.monitor.dc_deck_*` (and the hub's chip / tier names, `dc_hub_*`, so a
 * chip and the card it opens say the same thing) through the resolvers below,
 * which take the translation section as their first argument.
 */
import type { LucideIcon } from 'lucide-react';
import {
  CircleHelp,
  ClipboardCheck,
  Dna,
  FileText,
  Flag,
  Hammer,
  Landmark,
  Lightbulb,
  PackageCheck,
  MessagesSquare,
  ScrollText,
  ShieldCheck,
  Siren,
  SlidersHorizontal,
  Sparkles,
} from 'lucide-react';
import type { Translations } from '@/i18n/generated/types';
import type { TriageTone } from '@/features/agents/quick-answer/triage/triageTypes';
import type { DecisionChip, DecisionItem, DecisionKind, DecisionTier, HubChip } from '../model/decisionModel';
import { chipOf, modalTypeOf } from '../model/decisionModel';
import { decisionTier } from '../model/decisionOrder';
import { isLensKind } from '../lens/lensKinds';

/** The monitor section of the catalog — every deck word lives in it. */
export type MonitorCopy = Translations['monitor'];
/** `tx` from `useTranslation()`. */
export type Interpolate = (template: string, vars: Record<string, string | number>) => string;

/** The kind, drawn: one glyph per kind (the card's tile), the word only in the eyebrow. */
export const KIND_ICON: Record<DecisionKind, LucideIcon> = {
  review: ShieldCheck,
  question: CircleHelp,
  approval: Sparkles,
  policy: SlidersHorizontal,
  evolution: Dna,
  goal: Flag,
  idea: Lightbulb,
  incident: Siren,
  council: Landmark,
  report: FileText,
  message: MessagesSquare,
  mandate: ScrollText,
  build: Hammer,
  evidence: ClipboardCheck,
  release: PackageCheck,
};

/** Aurora tone suffix (`au-t-*` / `au-l-*` in aurora.css). */
export type AuroraTone = TriageTone | 'info' | 'agent' | 'human';

/** The kind's light — the aurora, the kind tile and the living border share it. */
export const CHIP_TONE: Record<HubChip, AuroraTone> = {
  gates: 'warning',
  proposals: 'agent',
  backlog: 'info',
  incidents: 'danger',
  council: 'human',
  reports: 'accent',
  chat: 'success',
  ready: 'success',
};

export const kindTone = (item: DecisionItem): AuroraTone => CHIP_TONE[chipOf(item.kind)];

/** Lamp tone -> urgency rank (chip glow strength). */
export const URGENCY: Record<TriageTone, number> = { danger: 3, warning: 2, accent: 1, success: 1, neutral: 0 };

/**
 * At most two tags, and never one that repeats something already on the card:
 * severity (the tier lamp says it; incidents say it in words), or the source's
 * own name / team (the ledger's monogram says it).
 */
export function cardTags(item: DecisionItem) {
  const seen = [item.source.label, item.source.sublabel ?? ''].map((s) => s.toLowerCase());
  return item.tags
    .filter((t) => t.id !== 'sev' && t.id !== 'severity' && !seen.includes(t.label.toLowerCase()))
    .slice(0, 2);
}

/** The chip's name — the hub's own word, so the strip and the eyebrow agree. */
export function chipLabel(m: MonitorCopy, chip: DecisionChip): string {
  switch (chip) {
    case 'gates': return m.dc_hub_chip_gates;
    case 'proposals': return m.dc_hub_chip_proposals;
    case 'backlog': return m.dc_hub_chip_backlog;
    case 'incidents': return m.dc_hub_chip_incidents;
    case 'council': return m.dc_hub_chip_council;
    case 'reports': return m.dc_hub_chip_reports;
    case 'chat': return m.dc_hub_chip_chat;
  }
}

export function kindLabel(m: MonitorCopy, kind: DecisionKind): string {
  switch (kind) {
    case 'review': return m.dc_deck_kind_review;
    case 'question': return m.dc_deck_kind_question;
    case 'approval': return m.dc_deck_kind_approval;
    case 'policy': return m.dc_deck_kind_policy;
    case 'evolution': return m.dc_deck_kind_evolution;
    case 'goal': return m.dc_deck_kind_goal;
    case 'idea': return m.dc_deck_kind_idea;
    case 'incident': return m.dc_deck_kind_incident;
    case 'council': return m.dc_deck_kind_council;
    case 'report': return m.dc_deck_kind_report;
    case 'message': return m.dc_deck_kind_message;
    case 'mandate': return m.ml_mandate;
    case 'build': return m.dc_deck_kind_build;
    case 'evidence': return m.dc_deck_kind_evidence;
    case 'release': return m.dc_deck_kind_release;
  }
}

/** The roster's own tier law (`decisionTier`), so the deck and the strip never disagree. */
export const tierOf = (item: DecisionItem): DecisionTier => decisionTier(item);

export const TIER_TONE: Record<DecisionTier, TriageTone> = { 1: 'danger', 2: 'accent', 3: 'neutral' };

export function tierLabel(m: MonitorCopy, tier: DecisionTier): string {
  if (tier === 1) return m.dc_hub_tier_blocking;
  if (tier === 2) return m.dc_hub_tier_decide;
  return m.dc_hub_tier_read;
}

function yesOfKind(m: MonitorCopy, kind: DecisionKind): string {
  switch (kind) {
    case 'review': return m.dc_deck_yes_review;
    case 'question': return m.dc_deck_yes_question;
    case 'approval': return m.dc_deck_yes_approval;
    case 'policy': return m.dc_deck_yes_policy;
    case 'evolution': return m.dc_deck_yes_evolution;
    case 'goal': return m.dc_deck_yes_goal;
    case 'idea': return m.dc_deck_yes_idea;
    case 'incident': return m.dc_deck_yes_incident;
    case 'council': return m.dc_deck_yes_council;
    case 'report': return m.dc_deck_yes_report;
    case 'message': return m.dc_deck_yes_chat;
    case 'mandate': return m.ml_sign_yes;
    // A lens-scan card never writes: its one verb opens the blueprint (or bp).
    case 'build':
    case 'evidence':
    case 'release': return m.dc_deck_yes_lens;
  }
}

/** One line: what saying yes does. The item's alert wins when it has one. */
export function yesDoes(m: MonitorCopy, tx: Interpolate, item: DecisionItem): string {
  if (item.alert?.detail) return item.alert.detail;
  if (item.kind === 'message') return tx(m.dc_deck_yes_chat, { name: item.source.label });
  // A re-read Sign card's yes keeps a SIGNED mandate as signed (mandate-lanes WP6).
  if (item.kind === 'mandate' && item.payload?.reread) return m.ml_reread_yes;
  return yesOfKind(m, item.kind);
}

function words(text: string): number {
  return text.replace(/<[^>]+>/g, ' ').split(/\s+/).filter(Boolean).length;
}

export function readMinutes(item: DecisionItem): number {
  return Math.max(1, Math.round(words(item.document?.content ?? item.body) / 220));
}

/** What clearing the item costs, in the unit that matters for its type. */
export function costOf(m: MonitorCopy, tx: Interpolate, item: DecisionItem): string {
  // A Sign card's cost is what signing releases (mandateItem `signCostLine`).
  // A lens-scan card's cost is its one gesture, open (lensAdapters).
  if ((item.kind === 'mandate' || isLensKind(item.kind)) && item.payload?.cost) return item.payload.cost;
  if (item.kind === 'question' && item.input) return tx(m.dc_deck_cost_answers, { count: item.input.fields.length });
  const type = modalTypeOf(item.kind);
  if (type === 'report') return tx(m.dc_deck_cost_read, { count: readMinutes(item) });
  if (type === 'chat') return m.dc_deck_cost_reply;
  if (type === 'backlog') {
    const effort = item.facts.find((f) => f.id === 'effort');
    return effort ? tx(m.dc_deck_cost_effort, { value: effort.value }) : m.dc_deck_cost_triage;
  }
  return m.dc_deck_cost_one_key;
}

/** Lamp tone -> dot fill (strip lamps, peek markers). */
export const LAMP_FILL: Record<TriageTone, string> = {
  neutral: 'bg-muted-foreground',
  accent: 'bg-primary',
  success: 'bg-status-success',
  warning: 'bg-status-warning',
  danger: 'bg-status-error',
};
