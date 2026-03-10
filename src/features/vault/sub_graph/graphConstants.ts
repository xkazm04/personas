import { Key, Bot, Zap } from 'lucide-react';
import type { GraphNodeKind } from './credentialGraph';

export const KIND_ICONS: Record<GraphNodeKind, typeof Key> = {
  credential: Key,
  agent: Bot,
  event: Zap,
};

export const KIND_LABELS: Record<GraphNodeKind, string> = {
  credential: 'Credentials',
  agent: 'Agents',
  event: 'Events',
};

export const SEVERITY_STYLES = {
  low: { bg: 'bg-emerald-500/10', text: 'text-emerald-400', border: 'border-emerald-500/20', label: 'Low Risk' },
  medium: { bg: 'bg-amber-500/10', text: 'text-amber-400', border: 'border-amber-500/20', label: 'Medium Risk' },
  high: { bg: 'bg-red-500/10', text: 'text-red-400', border: 'border-red-500/20', label: 'High Risk' },
} as const;
