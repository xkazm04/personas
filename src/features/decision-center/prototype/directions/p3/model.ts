/**
 * P3 "The Desk" — pure helpers shared by the strip, the peek and the desk.
 * The tier law is the model's (`decisionTier`), never restated here.
 */
import {
  Bell, FileText, Landmark, Lightbulb, ListTodo, MessageSquare, Rocket, ShieldCheck,
  type LucideIcon,
} from 'lucide-react';
import type { TriageTone } from '@/features/agents/quick-answer/triage/triageTypes';
import {
  chipOf, modalTypeOf,
  type DecisionChip, type DecisionItem, type DecisionTier, type HubChip,
} from '../../../model/decisionModel';
import { MOTION } from '@/lib/utils/designTokens';
import { decisionTier } from '../../../model/decisionOrder';

export const CHIP_META: Record<HubChip, { label: string; icon: LucideIcon; noun: string }> = {
  gates: { label: 'Gates', icon: ShieldCheck, noun: 'gate' },
  proposals: { label: 'Proposals', icon: Lightbulb, noun: 'proposal' },
  backlog: { label: 'Backlog', icon: ListTodo, noun: 'idea' },
  incidents: { label: 'Incidents', icon: Bell, noun: 'incident' },
  council: { label: 'Council', icon: Landmark, noun: 'council' },
  reports: { label: 'Reports', icon: FileText, noun: 'report' },
  chat: { label: 'Chat', icon: MessageSquare, noun: 'thread' },
  ready: { label: 'Ready', icon: Rocket, noun: 'ready task' },
};

/** Text colour per tone — semantic tokens only. */
export const TONE_TEXT: Record<TriageTone, string> = {
  neutral: 'text-muted-foreground',
  accent: 'text-primary',
  success: 'text-status-success',
  warning: 'text-status-warning',
  danger: 'text-status-error',
};

/** Fill per tone (lamps, meters, tier bars). */
export const TONE_FILL: Record<TriageTone, string> = {
  neutral: 'bg-foreground/25',
  accent: 'bg-primary',
  success: 'bg-status-success',
  warning: 'bg-status-warning',
  danger: 'bg-status-error',
};

export const TIER_TONE: Record<DecisionTier, TriageTone> = { 1: 'danger', 2: 'warning', 3: 'accent' };
export const TIER_LABEL: Record<DecisionTier, string> = { 1: 'Blocking', 2: 'Decide', 3: 'Read' };

export const tierOf: (item: DecisionItem) => DecisionTier = decisionTier;

function readMinutes(text: string): number {
  const words = text.replace(/<[^>]+>/g, ' ').split(/\s+/).filter(Boolean).length;
  return Math.max(1, Math.round(words / 200));
}

/** What deciding this item costs the operator — the peek's right column. */
export function costOf(item: DecisionItem): string {
  const type = modalTypeOf(item.kind);
  if (type === 'report') return `${readMinutes(item.document?.content ?? item.body)} min read`;
  if (type === 'chat') return 'Reply';
  if (type === 'backlog') {
    const effort = item.facts.find((f) => f.id === 'effort');
    return effort ? `Effort ${effort.value}/10` : 'Triage';
  }
  if (item.input?.fields.length) return `${item.input.fields.length} answers`;
  if (item.branches.length) return `1 key · ${item.branches.length} option${item.branches.length === 1 ? '' : 's'}`;
  return '1 key';
}

/** The items a desk walks: one chip, or the whole roster (Triage all). */
export function queueFor(items: DecisionItem[], chip: DecisionChip | 'all'): DecisionItem[] {
  return chip === 'all' ? items : items.filter((i) => chipOf(i.kind) === chip);
}

export function ageHours(iso: string, nowMs: number): number {
  return Math.max(0, (nowMs - Date.parse(iso)) / 3_600_000);
}

const sec = (ms: number) => ms / 1000;
export const DUR = {
  fast: sec(MOTION.duration.fast),
  normal: sec(MOTION.duration.normal),
  slow: sec(MOTION.duration.slow),
};
export const EASE = [0.22, 1, 0.36, 1] as const;

/** One slug law: the TOC and the rendered headings both call this. */
export function headingSlug(text: string): string {
  return `p3-h-${text.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')}`;
}

export interface Heading { id: string; text: string; depth: number }

/**
 * The document as the reader shows it: a leading H1 that repeats the item title
 * is dropped, because the desk header already carries that line.
 */
export function readerMarkdown(item: DecisionItem): string {
  const content = item.document?.content ?? '';
  const first = /^#\s+(.+?)[ \t]*\n/.exec(content);
  return first && first[1]!.replace(/[*_`]/g, '') === item.title ? content.slice(first[0].length) : content;
}

export function headingsOf(markdown: string): Heading[] {
  const out: Heading[] = [];
  for (const line of markdown.split('\n')) {
    // Sections only (## and ###): a document's # is its title, not a stop on the way.
    const m = /^(#{2,3})\s+(.+?)\s*$/.exec(line);
    if (!m) continue;
    const text = m[2]!.replace(/[*_`]/g, '');
    out.push({ id: headingSlug(text), text, depth: m[1]!.length });
  }
  return out;
}

/** True while the user types — letter shortcuts must not fire. */
export function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable;
}
