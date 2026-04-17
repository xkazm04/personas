import { Play, Zap, Brain, AlertTriangle, MessageSquare, type LucideIcon } from 'lucide-react';
import type { PersonaExecution } from '@/lib/bindings/PersonaExecution';
import type { PersonaEvent } from '@/lib/types/types';
import type { PersonaMemory } from '@/lib/types/types';
import type { PersonaMessage } from '@/lib/types/types';
import type { PersonaManualReview } from '@/lib/bindings/PersonaManualReview';

export type ActivityType = 'all' | 'execution' | 'event' | 'memory' | 'review' | 'message';

export interface ActivityItem {
  type: 'execution' | 'event' | 'memory' | 'review' | 'message';
  id: string;
  title: string;
  subtitle: string;
  status: string;
  timestamp: string;
  raw: PersonaExecution | PersonaEvent | PersonaMemory | PersonaManualReview | PersonaMessage;
}

export const TYPE_ICONS: Record<string, { icon: LucideIcon; color: string; bg: string }> = {
  execution: { icon: Play, color: 'text-blue-400', bg: 'bg-blue-500/10' },
  event: { icon: Zap, color: 'text-amber-400', bg: 'bg-amber-500/10' },
  memory: { icon: Brain, color: 'text-violet-400', bg: 'bg-violet-500/10' },
  review: { icon: AlertTriangle, color: 'text-rose-400', bg: 'bg-rose-500/10' },
  message: { icon: MessageSquare, color: 'text-cyan-400', bg: 'bg-cyan-500/10' },
};

export const FILTER_TABS: { id: ActivityType; label: string }[] = [
  { id: 'all', label: 'All' },
  { id: 'execution', label: 'Executions' },
  { id: 'event', label: 'Events' },
  { id: 'memory', label: 'Memories' },
  { id: 'review', label: 'Reviews' },
  { id: 'message', label: 'Messages' },
];

export function renderImportanceStars(status: string): string {
  const match = status.match(/(\d+)/);
  const importance = match?.[1] ? Math.min(10, Math.max(1, parseInt(match[1], 10))) : 5;
  const filled = Math.round(importance / 2);
  return '\u2605'.repeat(filled) + '\u2606'.repeat(5 - filled);
}
