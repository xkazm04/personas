import { Copy, AlertTriangle, ArrowRight } from 'lucide-react';
import type { ConflictKind } from './memoryConflicts';
import type { PersonaMemory } from '@/lib/bindings/PersonaMemory';
import { stripHtml } from '@/lib/utils/sanitizers/sanitizeHtml';

// ---------------------------------------------------------------------------
// Visual config
// ---------------------------------------------------------------------------

export const KIND_CONFIG: Record<
  ConflictKind,
  { label: string; color: string; bg: string; border: string; icon: typeof Copy }
> = {
  duplicate: { label: 'Duplicate', color: 'text-amber-400', bg: 'bg-amber-500/10', border: 'border-amber-500/20', icon: Copy },
  contradiction: { label: 'Contradiction', color: 'text-red-400', bg: 'bg-red-500/10', border: 'border-red-500/20', icon: AlertTriangle },
  superseded: { label: 'Superseded', color: 'text-blue-400', bg: 'bg-blue-500/10', border: 'border-blue-500/20', icon: ArrowRight },
};

export function kindBadge(kind: ConflictKind) {
  const cfg = KIND_CONFIG[kind];
  const Icon = cfg.icon;
  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 text-xs font-medium rounded-lg border ${cfg.bg} ${cfg.color} ${cfg.border}`}>
      <Icon className="w-3 h-3" />
      {cfg.label}
    </span>
  );
}

export function similarityBadge(sim: number) {
  const pct = Math.round(sim * 100);
  const color = pct >= 80 ? 'text-red-400' : pct >= 50 ? 'text-amber-400' : 'text-blue-400';
  return (
    <span className={`text-xs font-mono ${color}`}>{pct}%</span>
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

export const VARIANT_STYLES = {
  primary: 'bg-indigo-500/15 text-indigo-300 border-indigo-500/25 hover:bg-indigo-500/25',
  success: 'bg-emerald-500/15 text-emerald-300 border-emerald-500/25 hover:bg-emerald-500/25',
  muted: 'bg-secondary/40 text-muted-foreground/80 border-primary/15 hover:bg-secondary/60',
} as const;
