/**
 * Static configuration for QuestionnaireFormGrid:
 *   - CATEGORY_META: per-category icon / colour tokens
 *   - FALLBACK_CATEGORY: catch-all for unknown categories
 *   - Animation variants shared across the grid
 *   - groupByCategory helper
 */
import { Settings2, KeyRound, ShieldCheck, Brain, Bell, Globe, Gauge } from 'lucide-react';
import type { TransformQuestionResponse } from '@/api/templates/n8nTransform';

// ---------------------------------------------------------------------------
// Category meta
// ---------------------------------------------------------------------------

export const CATEGORY_META: Record<
  string,
  { label: string; Icon: React.ComponentType<{ className?: string }>; color: string; bg: string; border: string }
> = {
  credentials:       { label: 'Credentials',       Icon: KeyRound,    color: 'text-violet-400',  bg: 'bg-violet-500/[0.04]',  border: 'border-violet-500/15' },
  configuration:     { label: 'Configuration',     Icon: Settings2,   color: 'text-blue-400',    bg: 'bg-blue-500/[0.04]',    border: 'border-blue-500/15' },
  human_in_the_loop: { label: 'Human in the Loop', Icon: ShieldCheck, color: 'text-rose-400',    bg: 'bg-rose-500/[0.04]',    border: 'border-rose-500/15' },
  memory:            { label: 'Memory & Learning',  Icon: Brain,       color: 'text-purple-400',  bg: 'bg-purple-500/[0.04]',  border: 'border-purple-500/15' },
  notifications:     { label: 'Notifications',     Icon: Bell,        color: 'text-amber-400',   bg: 'bg-amber-500/[0.04]',   border: 'border-amber-500/15' },
  domain:            { label: 'Domain',            Icon: Globe,       color: 'text-cyan-400',    bg: 'bg-cyan-500/[0.04]',    border: 'border-cyan-500/15' },
  quality:           { label: 'Quality',           Icon: Gauge,       color: 'text-emerald-400', bg: 'bg-emerald-500/[0.04]', border: 'border-emerald-500/15' },
};

export const FALLBACK_CATEGORY = {
  label: 'Other',
  Icon: Settings2,
  color: 'text-zinc-400',
  bg: 'bg-white/[0.02]',
  border: 'border-white/[0.06]',
};

// ---------------------------------------------------------------------------
// Animation variants
// ---------------------------------------------------------------------------

export const containerVariants = {
  hidden: {},
  show: { transition: { staggerChildren: 0.06 } },
};

export const sectionVariants = {
  hidden: { opacity: 0, y: 12 },
  show: { opacity: 1, y: 0, transition: { duration: 0.3, ease: 'easeOut' as const } },
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

export function groupByCategory(questions: TransformQuestionResponse[]) {
  const groups: Record<string, TransformQuestionResponse[]> = {};
  for (const q of questions) {
    const key = q.category ?? '__other__';
    (groups[key] ??= []).push(q);
  }
  return groups;
}

// ---------------------------------------------------------------------------
// Phase C2 — scope-based grouping (capability-aware questionnaire)
// See `docs/concepts/persona-capabilities/C2-execution-plan.md` §Part 1.
// ---------------------------------------------------------------------------

export type QuestionScope = 'persona' | 'capability' | 'connector';

/** Derive a question's scope when the `scope` field is absent.
 *  Precedence: explicit scope → connector_names → single use_case_ids → persona. */
export function inferScope(q: TransformQuestionResponse): QuestionScope {
  if (q.scope) return q.scope;
  if (q.connector_names && q.connector_names.length > 0) return 'connector';
  if (q.use_case_ids && q.use_case_ids.length === 1) return 'capability';
  return 'persona';
}

/** Derive the capability id a question belongs to. */
export function scopeKey(q: TransformQuestionResponse): string {
  const scope = inferScope(q);
  if (scope === 'capability') {
    return q.use_case_id ?? (q.use_case_ids && q.use_case_ids[0]) ?? '__unknown_capability__';
  }
  if (scope === 'connector') {
    return (q.connector_names && q.connector_names[0]) ?? '__unknown_connector__';
  }
  return 'persona';
}

export interface ScopeSection {
  /** `persona` | `capability:uc_xxx` | `connector:name` */
  key: string;
  scope: QuestionScope;
  /** capability id or connector name; undefined for persona */
  subjectId?: string;
  questions: TransformQuestionResponse[];
}

/** Group questions by scope → capability/connector subject. Stable ordering:
 *  persona first, then capabilities (sorted by first occurrence), then connectors. */
export function groupByScope(questions: TransformQuestionResponse[]): ScopeSection[] {
  const personaQs: TransformQuestionResponse[] = [];
  const capabilityOrder: string[] = [];
  const capabilityQs = new Map<string, TransformQuestionResponse[]>();
  const connectorOrder: string[] = [];
  const connectorQs = new Map<string, TransformQuestionResponse[]>();

  for (const q of questions) {
    const scope = inferScope(q);
    if (scope === 'persona') {
      personaQs.push(q);
      continue;
    }
    if (scope === 'capability') {
      const id = scopeKey(q);
      if (!capabilityQs.has(id)) {
        capabilityQs.set(id, []);
        capabilityOrder.push(id);
      }
      capabilityQs.get(id)!.push(q);
      continue;
    }
    if (scope === 'connector') {
      const id = scopeKey(q);
      if (!connectorQs.has(id)) {
        connectorQs.set(id, []);
        connectorOrder.push(id);
      }
      connectorQs.get(id)!.push(q);
    }
  }

  const out: ScopeSection[] = [];
  if (personaQs.length) {
    out.push({ key: 'persona', scope: 'persona', questions: personaQs });
  }
  for (const id of capabilityOrder) {
    out.push({
      key: `capability:${id}`,
      scope: 'capability',
      subjectId: id,
      questions: capabilityQs.get(id)!,
    });
  }
  for (const id of connectorOrder) {
    out.push({
      key: `connector:${id}`,
      scope: 'connector',
      subjectId: id,
      questions: connectorQs.get(id)!,
    });
  }
  return out;
}

/** Whether the grouping produces more than one scope section — i.e. the
 *  v2 grouped layout should render. When every question falls under
 *  `persona`, render the legacy layout (no scope headings). */
export function hasMultiScope(sections: ScopeSection[]): boolean {
  return sections.length > 1;
}
