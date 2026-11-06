import { Play, Zap, Brain, AlertTriangle, MessageSquare, Eye, type LucideIcon } from 'lucide-react';
import type { PersonaExecution } from '@/lib/bindings/PersonaExecution';
import type { PersonaEvent } from '@/lib/types/types';
import type { PersonaMemory } from '@/lib/types/types';
import type { PersonaReport } from '@/lib/types/types';
import type { PersonaManualReview } from '@/lib/bindings/PersonaManualReview';
import type { AttentionLedgerEntry } from '@/lib/bindings/AttentionLedgerEntry';

export type ActivityType = 'all' | 'execution' | 'event' | 'memory' | 'review' | 'message' | 'attention';

export interface ActivityItem {
  type: 'execution' | 'event' | 'memory' | 'review' | 'message' | 'attention';
  id: string;
  title: string;
  subtitle: string;
  status: string;
  timestamp: string;
  /**
   * Capability (use case) attribution. Inherited from the originating
   * execution at dispatch time. Phase C5. `null` for persona-wide rows
   * (ad-hoc chat, budget alerts, reviews from non-capability runs).
   */
  useCaseId: string | null;
  raw: PersonaExecution | PersonaEvent | PersonaMemory | PersonaManualReview | PersonaReport | AttentionLedgerEntry;
}

export const TYPE_ICONS: Record<string, { icon: LucideIcon; color: string; bg: string }> = {
  execution: { icon: Play, color: 'text-status-info', bg: 'bg-status-info/10' },
  event: { icon: Zap, color: 'text-status-warning', bg: 'bg-status-warning/10' },
  memory: { icon: Brain, color: 'text-role-agent', bg: 'bg-role-agent/10' },
  review: { icon: AlertTriangle, color: 'text-status-error', bg: 'bg-status-error/10' },
  message: { icon: MessageSquare, color: 'text-role-external', bg: 'bg-role-external/10' },
  attention: { icon: Eye, color: 'text-role-external', bg: 'bg-role-external/10' },
};

/** The type-tab strip. `labelKey` names the `agents.activity_filters` entry;
 *  `null` marks the one tab whose label lives elsewhere (attention, resolved
 *  in ActivityFilters from `agents.life.activity_filter_attention`). */
export type ActivityFilterLabelKey = 'all' | 'executions' | 'events' | 'memories' | 'reviews' | 'messages';
export const FILTER_TABS: { id: ActivityType; labelKey: ActivityFilterLabelKey | null }[] = [
  { id: 'all', labelKey: 'all' },
  { id: 'execution', labelKey: 'executions' },
  { id: 'event', labelKey: 'events' },
  { id: 'memory', labelKey: 'memories' },
  { id: 'review', labelKey: 'reviews' },
  { id: 'message', labelKey: 'messages' },
  { id: 'attention', labelKey: null },
];

export function renderImportanceStars(status: string): string {
  const match = status.match(/(\d+)/);
  const importance = match?.[1] ? Math.min(10, Math.max(1, parseInt(match[1], 10))) : 5;
  const filled = Math.round(importance / 2);
  return '\u2605'.repeat(filled) + '\u2606'.repeat(5 - filled);
}

/** Render a 0-5 Director verdict score as filled/hollow stars (\u2605\u2605\u2605\u2606\u2606). */
export function renderScoreStars(score: number): string {
  const filled = Math.min(5, Math.max(0, Math.round(score)));
  return '\u2605'.repeat(filled) + '\u2606'.repeat(5 - filled);
}
