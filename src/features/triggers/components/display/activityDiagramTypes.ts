import {
  Play,
  CheckCircle2,
  Wrench,
  GitBranch,
  Zap,
  ShieldAlert,
  Plug,
} from 'lucide-react';

// ============================================================================
// Types
// ============================================================================

export interface NodeTypeMeta {
  label: string;
  color: string;
  Icon: React.ComponentType<{ className?: string; style?: React.CSSProperties }>;
  cardStyle: string;
  textColor: string;
  iconColor: string;
}

// ============================================================================
// Constants
// ============================================================================

export const NODE_TYPE_META: Record<string, NodeTypeMeta> = {
  start: {
    label: 'Start', color: '#10b981', Icon: Play,
    cardStyle: 'rounded-full bg-emerald-500/10 border-emerald-500/30 shadow-[0_0_12px_rgba(16,185,129,0.15)]',
    textColor: 'text-emerald-300', iconColor: 'text-emerald-400',
  },
  end: {
    label: 'End', color: '#3b82f6', Icon: CheckCircle2,
    cardStyle: 'rounded-full bg-blue-500/10 border-blue-500/30 shadow-[0_0_12px_rgba(59,130,246,0.15)]',
    textColor: 'text-blue-300', iconColor: 'text-blue-400',
  },
  action: {
    label: 'Action', color: '#64748b', Icon: Wrench,
    cardStyle: 'bg-secondary/60 border-primary/20',
    textColor: 'text-foreground/90', iconColor: 'text-muted-foreground',
  },
  decision: {
    label: 'Decision', color: '#f59e0b', Icon: GitBranch,
    cardStyle: 'bg-amber-500/10 border-2 border-amber-500/30 shadow-[0_0_12px_rgba(245,158,11,0.15)]',
    textColor: 'text-amber-300', iconColor: 'text-amber-400',
  },
  connector: {
    label: 'Connector', color: '#8b5cf6', Icon: Plug,
    cardStyle: 'bg-secondary/60 border-2 border-violet-500/30 shadow-[0_0_16px_rgba(139,92,246,0.1)]',
    textColor: 'text-foreground/90', iconColor: 'text-violet-400',
  },
  event: {
    label: 'Event', color: '#8b5cf6', Icon: Zap,
    cardStyle: 'bg-violet-500/10 border-violet-500/30 shadow-[0_0_12px_rgba(139,92,246,0.15)]',
    textColor: 'text-violet-300', iconColor: 'text-violet-400',
  },
  error: {
    label: 'Error', color: '#ef4444', Icon: ShieldAlert,
    cardStyle: 'bg-red-500/10 border-dashed border-red-500/30 shadow-[0_0_12px_rgba(239,68,68,0.15)]',
    textColor: 'text-red-300', iconColor: 'text-red-400',
  },
};

export const DEFAULT_NODE_META: NodeTypeMeta = {
  label: 'Action', color: '#64748b', Icon: Wrench,
  cardStyle: 'bg-secondary/60 border-primary/20',
  textColor: 'text-foreground/90', iconColor: 'text-muted-foreground',
};
