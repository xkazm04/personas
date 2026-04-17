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
