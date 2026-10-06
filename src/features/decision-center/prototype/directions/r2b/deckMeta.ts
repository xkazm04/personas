/**
 * R2-B "Swiss Instrument" — the static vocabulary every part reads: what a
 * chip and a kind are called and drawn as, the ONE accent each kind wears,
 * which tier an item sits in, what saying yes does, and what an item costs to
 * clear (split into a figure and its unit, because the figure is the hero).
 * Prototype data (English literals are allowed in this dev-only folder),
 * React-free.
 *
 * `tierOf` is a LOCAL stand-in for `decisionTier` (still a WP0 stub that
 * throws). It follows the tier law written in `decisionModel.ts` so the
 * prototype reads the way the real roster will.
 */
import type { LucideIcon } from 'lucide-react';
import {
  Clock,
  FileText,
  Flag,
  Gauge,
  Landmark,
  Lightbulb,
  MessagesSquare,
  Repeat,
  Rocket,
  Route,
  ShieldCheck,
  ShieldQuestion,
  Siren,
  Sparkles,
  Stamp,
  Dna,
  Target,
  Users,
} from 'lucide-react';
import type { TriageFact, TriageTone } from '@/features/agents/quick-answer/triage/triageTypes';
import type { DecisionItem, DecisionKind, DecisionTier, HubChip } from '../../../model/decisionModel';
import { chipOf, modalTypeOf } from '../../../model/decisionModel';

export const CHIP_META: Record<HubChip, { label: string; icon: LucideIcon; hint: string }> = {
  gates: { label: 'Gates', icon: ShieldCheck, hint: 'Reviews, questions and approvals holding work' },
  proposals: { label: 'Proposals', icon: Stamp, hint: 'Policy, promotion and goal sign-offs' },
  backlog: { label: 'Backlog', icon: Lightbulb, hint: 'Scanner ideas waiting for a verdict' },
  incidents: { label: 'Incidents', icon: Siren, hint: 'Failures and alerts' },
  council: { label: 'Council', icon: Landmark, hint: 'Council verdicts to approve or send back' },
  reports: { label: 'Reports', icon: FileText, hint: 'Unread reports' },
  chat: { label: 'Chat', icon: MessagesSquare, hint: 'Threads waiting for your reply' },
  ready: { label: 'Ready', icon: Rocket, hint: 'Accepted ideas ready to dispatch' },
};

/**
 * The one accent per kind family, as a CSS colour expression (a token, never
 * a hue). The strip stays monochrome; this tone lives on the card (its index
 * rule, kind tile and eyebrow) and on the peek's header.
 */
export const CHIP_TONE: Record<HubChip, string> = {
  gates: 'var(--status-warning)',
  proposals: 'var(--role-agent)',
  backlog: 'var(--primary)',
  incidents: 'var(--status-error)',
  council: 'var(--status-info)',
  reports: 'var(--role-external)',
  chat: 'var(--role-human)',
  ready: 'var(--status-success)',
};

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

/** Kind glyph: shield = gate, sparkle = Athena, lightbulb = idea, siren = incident, landmark = council… */
export const KIND_ICON: Record<DecisionKind, LucideIcon> = {
  review: ShieldCheck,
  question: ShieldQuestion,
  approval: Sparkles,
  policy: Route,
  evolution: Dna,
  goal: Flag,
  idea: Lightbulb,
  incident: Siren,
  council: Landmark,
  report: FileText,
  message: MessagesSquare,
};

export function toneOf(item: DecisionItem): string {
  return CHIP_TONE[chipOf(item.kind)];
}

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

/** Tier as a colour expression — the peek's stripe, the tray ruler's ticks, the card lamp. */
export const TIER_TONE: Record<DecisionTier, string> = {
  1: 'var(--status-error)',
  2: 'var(--primary)',
  3: 'var(--muted-foreground)',
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

/** What clearing the item costs: the figure (the hero) and its unit. */
export function costParts(item: DecisionItem): { value: string; unit: string } {
  if (item.kind === 'question' && item.input) return { value: String(item.input.fields.length), unit: 'answers' };
  const type = modalTypeOf(item.kind);
  if (type === 'report') return { value: String(readMinutes(item)), unit: 'min read' };
  if (type === 'chat') return { value: '1', unit: 'reply' };
  if (type === 'backlog') {
    const effort = item.facts.find((f) => f.id === 'effort');
    return effort ? { value: effort.value, unit: 'effort' } : { value: '—', unit: 'triage' };
  }
  return { value: '1', unit: 'key' };
}

export function costOf(item: DecisionItem): string {
  const c = costParts(item);
  return `${c.value} ${c.unit}`;
}

/** Severity is drawn as a lamp; its word appears only where severity is the subject (incidents). */
export function severityTag(item: DecisionItem) {
  return item.tags.find((t) => t.id === 'sev') ?? null;
}

/**
 * At most two tags, and only the ones that say something the card does not
 * already say: the severity rides the lamp, a team that is the source's own
 * sub-label is already under the avatar, a score is a meter.
 */
export function visibleTags(item: DecisionItem) {
  const said = [item.source.label, item.source.sublabel ?? ''].map((s) => s.toLowerCase());
  return item.tags
    .filter((t) => t.id !== 'sev' && t.id !== 'score' && !said.includes(t.label.toLowerCase()))
    .slice(0, 2);
}

/** A plain ledger fact's glyph, when the concept is universal; null keeps its word. */
export function factIcon(fact: TriageFact): LucideIcon | null {
  switch (fact.id) {
    case 'count': return Repeat;
    case 'first': return Clock;
    case 'members': return Users;
    case 'conf': return Target;
    default: return null;
  }
}

export const CLOCK_ICON = Clock;
export const COST_ICON = Gauge;

/** Lamp tone -> colour expression (strip lamps, peek markers). */
export const LAMP_TONE: Record<TriageTone, string> = {
  neutral: 'var(--muted-foreground)',
  accent: 'var(--primary)',
  success: 'var(--status-success)',
  warning: 'var(--status-warning)',
  danger: 'var(--status-error)',
};
