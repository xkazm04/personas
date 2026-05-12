import { Copy, AlertTriangle, ArrowRight } from 'lucide-react';
import type { ConflictKind } from './memoryConflicts';

const KIND_CONFIG: Record<ConflictKind, { label: string; color: string; bg: string; border: string; icon: typeof Copy }> = {
  duplicate: { label: 'Duplicate', color: 'text-amber-400', bg: 'bg-amber-500/10', border: 'border-amber-500/20', icon: Copy },
  contradiction: { label: 'Contradiction', color: 'text-red-400', bg: 'bg-red-500/10', border: 'border-red-500/20', icon: AlertTriangle },
  superseded: { label: 'Superseded', color: 'text-blue-400', bg: 'bg-blue-500/10', border: 'border-blue-500/20', icon: ArrowRight },
};

export function kindBadge(kind: ConflictKind) {
  const cfg = KIND_CONFIG[kind];
  const Icon = cfg.icon;
  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 typo-caption font-medium rounded-card border ${cfg.bg} ${cfg.color} ${cfg.border}`}>
      <Icon className="w-3 h-3" />
      {cfg.label}
    </span>
  );
}

export function similarityBadge(sim: number) {
  const pct = Math.round(sim * 100);
  const color = pct >= 80 ? 'text-red-400' : pct >= 50 ? 'text-amber-400' : 'text-blue-400';
  return (
    <span className={`typo-code font-mono ${color}`}>{pct}%</span>
  );
}
