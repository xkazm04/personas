import { RevealItem } from '@/features/shared/components/display/RevealItem';
import type { ReleasesTranslation } from './i18n/useReleasesTranslation';
import type { DisplayItem } from './roadmapItems';
import { statusDot, type RevealTracker } from './releaseTones';

export function RoadmapHero({ item, enter, t }: { item: DisplayItem; enter: RevealTracker; t: ReleasesTranslation }) {
  return (
    <RevealItem revealId={item.id} order={0} hasEntered={enter.hasEntered} markEntered={enter.markEntered}>
      <article>
        <div className="mb-3 flex flex-wrap items-center gap-3">
          <span className="relative flex items-center gap-2">
            <span className={`relative h-2 w-2 rounded-full ${statusDot[item.status]}`}>
              {item.status === 'in_progress' && (
                <span className="absolute inset-0 -m-0.5 rounded-full bg-cyan-400/30 animate-ping" />
              )}
            </span>
            <span className="font-mono text-xs uppercase tracking-[0.22em] text-cyan-400">{t.itemStatus[item.status]}</span>
          </span>
          <span className="font-mono text-xs text-foreground">· #{item.sort_order} · {t.priority[item.priority]}</span>
        </div>
        <div className="rounded-modal border border-cyan-500/15 bg-gradient-to-br from-cyan-500/[0.05] via-primary/[0.03] to-transparent p-7">
          <h2 className="typo-heading text-primary [text-shadow:_0_0_18px_color-mix(in_oklab,var(--primary)_38%,transparent)]">
            {item.title}
          </h2>
          {item.description && (
            <p className="typo-body mt-4 max-w-prose text-foreground">{item.description}</p>
          )}
        </div>
      </article>
    </RevealItem>
  );
}
