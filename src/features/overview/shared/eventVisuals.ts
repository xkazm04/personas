import {
  AlertCircle,
  AlertTriangle,
  BookOpen,
  CheckCircle,
  CheckCircle2,
  ChevronDown,
  Clock,
  Loader2,
  RefreshCw,
  Search,
  Tag,
  type LucideIcon,
} from 'lucide-react';
import { healthScale, type StatusColorScale } from '@/lib/design/statusTokens';

export { EVENT_TYPE_HEX_COLORS } from '@/lib/design/eventTokens';

export type EventStatusToken =
  | 'pending'
  | 'processing'
  | 'completed'
  | 'processed'
  | 'failed'
  | 'skipped';

export interface StatusIconMeta {
  icon: LucideIcon;
  color: string;
}

export const STATUS_ICONS: Record<EventStatusToken, StatusIconMeta> = {
  pending:    { icon: Clock,        color: 'text-amber-400' },
  processing: { icon: Loader2,      color: 'text-blue-400' },
  completed:  { icon: CheckCircle2, color: 'text-emerald-400' },
  processed:  { icon: CheckCircle2, color: 'text-emerald-400' },
  failed:     { icon: AlertCircle,  color: 'text-red-400' },
  skipped:    { icon: ChevronDown,  color: 'text-foreground' },
};

export function resolveStatusIcon(status: string): StatusIconMeta {
  return STATUS_ICONS[status as EventStatusToken] ?? STATUS_ICONS.pending;
}

export type HealingEventToken =
  | 'trigger'
  | 'classify'
  | 'retry'
  | 'ai_heal'
  | 'outcome'
  | 'knowledge';

const RETRY_COLORS: StatusColorScale = {
  dot: 'bg-cyan-400',
  line: 'bg-cyan-400/30',
  bg: 'bg-cyan-500/10',
  text: 'text-cyan-400',
  border: 'border-cyan-500/20',
};

const AI_HEAL_COLORS: StatusColorScale = {
  dot: 'bg-violet-400',
  line: 'bg-violet-400/30',
  bg: 'bg-violet-500/10',
  text: 'text-violet-400',
  border: 'border-violet-500/20',
};

export const HEALING_EVENT_ICONS: Record<HealingEventToken, LucideIcon> = {
  trigger:   AlertTriangle,
  classify:  Tag,
  retry:     RefreshCw,
  ai_heal:   Search,
  outcome:   CheckCircle,
  knowledge: BookOpen,
};

export const HEALING_EVENT_COLORS: Record<HealingEventToken, StatusColorScale> = {
  trigger:   healthScale('critical'),
  classify:  healthScale('warning'),
  retry:     RETRY_COLORS,
  ai_heal:   AI_HEAL_COLORS,
  outcome:   healthScale('healthy'),
  knowledge: healthScale('info'),
};

export function resolveHealingEventVisual(
  token: string,
): { icon: LucideIcon; colors: StatusColorScale } {
  const key = token as HealingEventToken;
  switch (key) {
    case 'trigger':
    case 'classify':
    case 'retry':
    case 'ai_heal':
    case 'outcome':
    case 'knowledge':
      return { icon: HEALING_EVENT_ICONS[key], colors: HEALING_EVENT_COLORS[key] };
    default: {
      // Exhaustiveness guard: adding a new HealingEventToken without a case
      // here will surface as a TS error on this assignment.
      const _exhaustive: never = key;
      void _exhaustive;
      return { icon: HEALING_EVENT_ICONS.trigger, colors: HEALING_EVENT_COLORS.trigger };
    }
  }
}
