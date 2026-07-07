/**
 * Explore prototype — small shared presentational bits used across all three
 * variants (kept together so the variant files stay focused on layout).
 * PROTOTYPE: hardcoded English, i18n deferred.
 */
import { FileStack, Blocks, UserRound, CheckCircle2, type LucideIcon } from 'lucide-react';
import type { ExploreItem, Difficulty, ItemKind } from '../exploreMockData';

const KIND_META: Record<ItemKind, { label: string; icon: LucideIcon }> = {
  template: { label: 'Template', icon: FileStack },
  recipe:   { label: 'Recipe',   icon: Blocks },
  persona:  { label: 'Persona',  icon: UserRound },
};

export function KindBadge({ kind }: { kind: ItemKind }) {
  const m = KIND_META[kind];
  const Icon = m.icon;
  return (
    <span className="inline-flex items-center gap-1 typo-caption text-foreground">
      <Icon className="w-3 h-3 opacity-70" />
      {m.label}
    </span>
  );
}

const DIFF_COLOR: Record<Difficulty, string> = {
  starter: '#10b981',
  intermediate: '#f59e0b',
  advanced: '#ef4444',
};

export function DifficultyDot({ difficulty }: { difficulty: Difficulty }) {
  return (
    <span className="inline-flex items-center gap-1 typo-caption capitalize text-foreground">
      <span className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: DIFF_COLOR[difficulty] }} />
      {difficulty}
    </span>
  );
}

export function ReadyPill() {
  return (
    <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-input typo-caption text-emerald-400 bg-emerald-500/10 border border-emerald-500/20">
      <CheckCircle2 className="w-3 h-3" />
      Ready
    </span>
  );
}

/** Popularity → a normalized 0..1 weight (drives node sizing in the map views). */
export function popularityWeight(p: number, max = 320): number {
  return Math.max(0.15, Math.min(1, p / max));
}

/** Small stat line reused on cards. */
export function ItemMeta({ item }: { item: ExploreItem }) {
  return (
    <div className="flex items-center gap-3 flex-wrap">
      <KindBadge kind={item.kind} />
      <DifficultyDot difficulty={item.difficulty} />
      <span className="typo-caption text-foreground opacity-70">{item.popularity} adopts</span>
      {item.ready && <ReadyPill />}
    </div>
  );
}
