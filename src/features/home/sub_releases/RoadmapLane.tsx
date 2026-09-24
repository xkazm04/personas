import { Suspense, lazy } from 'react';
import { RevealItem } from '@/features/shared/components/display/RevealItem';
import type { ReleaseItemPriority } from '@/data/releases';
import type { ReleasesTranslation } from './i18n/useReleasesTranslation';
import type { DisplayItem } from './roadmapItems';
import { statusDot, type RevealTracker } from './releaseTones';

// Traced glyph carries ~10KB gzipped of path data; lazy so it lands with the
// roadmap tab instead of the eager entry chunk. It animates itself in on mount,
// so the one-frame Suspense gap is invisible.
const RoadmapLaneEmptyGlyph = lazy(() => import('./RoadmapLaneEmptyGlyph'));

const laneAccent: Record<ReleaseItemPriority, { label: string; bg: string; border: string; chip: string }> = {
  now: { label: 'text-cyan-400', bg: 'bg-cyan-500/8', border: 'border-cyan-500/20', chip: 'text-cyan-400' },
  next: { label: 'text-purple-400', bg: 'bg-purple-500/8', border: 'border-purple-500/20', chip: 'text-purple-400' },
  later: { label: 'text-foreground', bg: 'bg-secondary/40', border: 'border-primary/12', chip: 'text-foreground' },
};

export function RoadmapLane({ priority, items, enter, t }: { priority: ReleaseItemPriority; items: DisplayItem[]; enter: RevealTracker; t: ReleasesTranslation }) {
  const accent = laneAccent[priority];
  return (
    <div className="flex flex-col gap-3">
      <header className="flex items-center justify-between border-b border-primary/8 pb-2">
        <span className={`typo-label ${accent.label}`}>{t.priority[priority]}</span>
        <span className={`rounded-full border px-1.5 py-0.5 font-mono text-[11px] font-medium ${accent.bg} ${accent.border} ${accent.chip}`}>
          {items.length}
        </span>
      </header>
      {items.length === 0 ? (
        <div className="flex h-24 flex-col items-center justify-center gap-1 rounded-modal border border-dashed border-primary/8">
          <Suspense fallback={<div className="h-12 w-12" />}>
            <RoadmapLaneEmptyGlyph />
          </Suspense>
          <span className="typo-caption text-foreground">{t.laneEmpty}</span>
        </div>
      ) : (
        <div className="space-y-3">
          {items.map((item, index) => (
            <RevealItem key={item.id} revealId={item.id} order={index} hasEntered={enter.hasEntered} markEntered={enter.markEntered}>
              <div className="relative overflow-hidden rounded-modal border border-primary/8 bg-gradient-to-br from-primary/[0.03] to-transparent p-4 pl-5">
                <div className={`absolute inset-y-3 left-1.5 w-[3px] rounded-full ${statusDot[item.status]}`} />
                <h3 className="typo-heading text-primary">{item.title}</h3>
                <div className="mt-1.5 font-mono text-xs uppercase tracking-wider text-foreground">{t.itemStatus[item.status]}</div>
                {item.description && <p className="typo-body mt-2 text-foreground">{item.description}</p>}
              </div>
            </RevealItem>
          ))}
        </div>
      )}
    </div>
  );
}
