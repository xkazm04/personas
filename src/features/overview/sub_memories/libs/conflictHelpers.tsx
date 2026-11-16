import { Copy, AlertTriangle, ArrowRight } from 'lucide-react';
import type { ConflictKind } from './memoryConflicts';
import type { PersonaMemory } from '@/lib/bindings/PersonaMemory';
import { stripHtml } from '@/lib/utils/sanitizers/sanitizeHtml';

// ---------------------------------------------------------------------------
// Visual config
// ---------------------------------------------------------------------------

export const KIND_CONFIG: Record<
  ConflictKind,
  { color: string; bg: string; border: string; icon: typeof Copy }
> = {
  duplicate: { color: 'text-status-warning', bg: 'bg-status-warning/10', border: 'border-status-warning/20', icon: Copy },
  contradiction: { color: 'text-status-error', bg: 'bg-status-error/10', border: 'border-status-error/20', icon: AlertTriangle },
  superseded: { color: 'text-status-info', bg: 'bg-status-info/10', border: 'border-status-info/20', icon: ArrowRight },
};

export function kindBadge(kind: ConflictKind, label: string) {
  const cfg = KIND_CONFIG[kind];
  const Icon = cfg.icon;
  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 typo-caption rounded-card border ${cfg.bg} ${cfg.color} ${cfg.border}`}>
      <Icon className="w-3 h-3" />
      {label}
    </span>
  );
}

export function similarityBadge(sim: number) {
  const pct = Math.round(sim * 100);
  const color = pct >= 80 ? 'text-status-error' : pct >= 50 ? 'text-status-warning' : 'text-status-info';
  return (
    <span className={`typo-code ${color}`}>{pct}%</span>
  );
}

// ---------------------------------------------------------------------------
// Merge helper
// ---------------------------------------------------------------------------

export function mergeMemories(a: PersonaMemory, b: PersonaMemory): {
  persona_id: string;
  title: string;
  content: string;
  category: string;
  importance: number;
  tags: string[];
} {
  const tagsA: string[] = a.tags ?? [];
  const tagsB: string[] = b.tags ?? [];
  const mergedTags = [...new Set([...tagsA, ...tagsB])];

  const newer = new Date(a.created_at) > new Date(b.created_at) ? a : b;

  const contentA = stripHtml(a.content).trim();
  const contentB = stripHtml(b.content).trim();
  const mergedContent = contentA === contentB
    ? contentA
    : `${contentA}\n\n---\n\n${contentB}`;

  return {
    persona_id: newer.persona_id,
    title: stripHtml(newer.title),
    content: mergedContent,
    category: newer.category,
    importance: Math.max(a.importance, b.importance),
    tags: mergedTags,
  };
}

