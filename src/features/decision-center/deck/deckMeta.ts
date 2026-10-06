/**
 * P2 "Deck & Ledger" — the static vocabulary every part reads: what a chip and
 * a kind are called and drawn as, which tier an item sits in, what saying yes
 * does, and what an item costs to clear. Prototype data (English literals are
 * allowed in this dev-only folder), React-free.
 *
 * `tierOf` is a LOCAL stand-in for `decisionTier` (still a WP0 stub that
 * throws). It follows the tier law written in `decisionModel.ts` so the
 * prototype reads the way the real roster will.
 */
import type { LucideIcon } from 'lucide-react';
import {
  CircleHelp,
  Dna,
  FileText,
  Flag,
  Landmark,
  Lightbulb,
  MessagesSquare,
  Rocket,
  ShieldCheck,
  Siren,
  SlidersHorizontal,
  Sparkles,
  Vote,
} from 'lucide-react';
import type { TriageTone } from '@/features/agents/quick-answer/triage/triageTypes';
import type { DecisionItem, DecisionKind, DecisionTier, HubChip } from '../model/decisionModel';
import { chipOf, modalTypeOf } from '../model/decisionModel';

export const CHIP_META: Record<HubChip, { label: string; icon: LucideIcon; hint: string }> = {
  gates: { label: 'Gates', icon: ShieldCheck, hint: 'Reviews, questions and approvals holding work' },
  proposals: { label: 'Proposals', icon: Vote, hint: 'Policy, promotion and goal sign-offs' },
  backlog: { label: 'Backlog', icon: Lightbulb, hint: 'Scanner ideas waiting for a verdict' },
  incidents: { label: 'Incidents', icon: Siren, hint: 'Failures and alerts' },
  council: { label: 'Council', icon: Landmark, hint: 'Council verdicts to approve or send back' },
  reports: { label: 'Reports', icon: FileText, hint: 'Unread reports' },
  chat: { label: 'Chat', icon: MessagesSquare, hint: 'Threads waiting for your reply' },
  ready: { label: 'Ready', icon: Rocket, hint: 'Accepted ideas ready to dispatch' },
};

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
    .filter((t) => t.id !== 'sev' && !seen.includes(t.label.toLowerCase()))
    .slice(0, 2);
}

export const KIND_LABEL: Record<DecisionKind, string> = {
  review: 'Review',
  question: 'Question',
  approval: 'Companion approval',
  policy: 'Policy',
  evolution: 'Promotion',
  goal: 'Goal sign-off',
  idea: 'Idea',
  incident: 'Incident',
  council: 'Council verdict',
  report: 'Report',
  message: 'Message',
};

export function tierOf(item: DecisionItem): DecisionTier {
  if (item.kind === 'incident') return item.severity === 'critical' || item.severity === 'high' ? 1 : 2;
  if (item.kind === 'approval') return 1;
  if (item.kind === 'review' && item.alert) return 1;
  if (item.kind === 'report' || item.kind === 'message') return 3;
  return 2;
}

export const TIER_META: Record<DecisionTier, { label: string; tone: TriageTone }> = {
  1: { label: 'Blocking', tone: 'danger' },
  2: { label: 'Decide', tone: 'accent' },
  3: { label: 'Read / reply', tone: 'neutral' },
};

/** Tier stripe fill — the peek's left edge and the card's spine. */
export const TIER_FILL: Record<DecisionTier, string> = {
  1: 'bg-status-error',
  2: 'bg-primary',
  3: 'bg-muted-foreground',
};

const YES_DOES: Record<DecisionKind, string> = {
  review: 'The run resumes with this output.',
  question: 'Your answers are sent and the build resumes.',
  approval: 'Athena carries the action out now.',
  policy: 'The routing change is applied fleet-wide.',
  evolution: 'The challenger replaces the incumbent.',
  goal: 'The goal is signed off and closed.',
  idea: 'It moves to Ready to dispatch.',
  incident: 'The incident is marked resolved.',
  council: 'The council verdict is accepted and the work proceeds.',
  report: 'The report is marked read.',
  message: 'Your reply is posted to the thread.',
};

/** One line: what saying yes does. The item's alert wins when it has one. */
export function yesDoes(item: DecisionItem): string {
  return item.alert?.detail ?? YES_DOES[item.kind];
}

function words(text: string): number {
  return text.replace(/<[^>]+>/g, ' ').split(/\s+/).filter(Boolean).length;
}

export function readMinutes(item: DecisionItem): number {
  return Math.max(1, Math.round(words(item.document?.content ?? item.body) / 220));
}

/** What clearing the item costs, in the unit that matters for its type. */
export function costOf(item: DecisionItem): string {
  if (item.kind === 'question' && item.input) return `${item.input.fields.length} answers`;
  const type = modalTypeOf(item.kind);
  if (type === 'report') return `${readMinutes(item)} min read`;
  if (type === 'chat') return 'reply';
  if (type === 'backlog') {
    const effort = item.facts.find((f) => f.id === 'effort');
    return effort ? `effort ${effort.value}` : 'triage';
  }
  return '1 key';
}

/** Lamp tone -> dot fill (strip lamps, peek markers). */
export const LAMP_FILL: Record<TriageTone, string> = {
  neutral: 'bg-muted-foreground',
  accent: 'bg-primary',
  success: 'bg-status-success',
  warning: 'bg-status-warning',
  danger: 'bg-status-error',
};
