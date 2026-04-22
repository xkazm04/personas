import {
  Calendar, ListTodo, Plug, MessageSquare,
  UserCheck, Brain, Activity, AlertTriangle,
} from 'lucide-react';
import type { GlyphDimension, DimMetaMap } from './types';

export const DIM_META: DimMetaMap = {
  trigger:   { labelKey: 'dim_trigger',   icon: Calendar,      color: '#fbbf24', colorClass: 'text-amber-400' },
  task:      { labelKey: 'dim_task',      icon: ListTodo,      color: '#a78bfa', colorClass: 'text-violet-400' },
  connector: { labelKey: 'dim_apps',      icon: Plug,          color: '#22d3ee', colorClass: 'text-cyan-400' },
  message:   { labelKey: 'dim_message',   icon: MessageSquare, color: '#60a5fa', colorClass: 'text-blue-400' },
  review:    { labelKey: 'dim_review',    icon: UserCheck,     color: '#fb7185', colorClass: 'text-rose-400' },
  memory:    { labelKey: 'dim_memory',    icon: Brain,         color: '#c084fc', colorClass: 'text-purple-400' },
  event:     { labelKey: 'dim_event',     icon: Activity,      color: '#2dd4bf', colorClass: 'text-teal-400' },
  error:     { labelKey: 'dim_error',     icon: AlertTriangle, color: '#fb923c', colorClass: 'text-orange-400' },
};

export const PETAL_ANGLES: Record<GlyphDimension, number> = {
  trigger: 0, task: 45, connector: 90, message: 135,
  review: 180, memory: 225, event: 270, error: 315,
};
