import { RevealItem } from '@/features/shared/components/display/RevealItem';
import type { ReleasesTranslation } from './i18n/useReleasesTranslation';
import type { DisplayItem } from './roadmapItems';
import { ITEM_STATUS_HEAD, ITEM_STATUS_RAIL, type RevealTracker } from './releaseTones';

/** The featured card: the one roadmap item in progress, set apart from the lanes. */
export function RoadmapHero({ item, enter, t }: { item: DisplayItem; enter: RevealTracker; t: ReleasesTranslation }) {
  return (
    <RevealItem revealId={item.id} order={0} hasEntered={enter.hasEntered} markEntered={enter.markEntered}>
      <article>
        <div className="mb-3 flex flex-wrap items-center gap-3">
          <span className="flex items-center gap-2">
            <span className={`relative h-2 w-2 rounded-full ${ITEM_STATUS_RAIL[item.status]}`}>
              {/* The ping is the page's only motion: work is happening on this item. */}
              {item.status === 'in_progress' && (
                <span className="absolute inset-0 -m-0.5 rounded-full bg-primary/30 animate-ping" />
              )}
            </span>
            {/* style-deviation: operator Gate 1 kept the tracked mono micro head; typo-eyebrow is sans at 0.06em and read worse, no token carries 0.22em tracking. */}
            <span className={`typo-code uppercase tracking-[0.22em] ${ITEM_STATUS_HEAD[item.status]}`}>{t.itemStatus[item.status]}</span>
          </span>
          <span className="typo-code text-foreground">· #{item.sort_order} · {t.priority[item.priority]}</span>
        </div>
        <div className="rounded-modal border border-primary/15 bg-gradient-to-br from-primary/5 via-primary/3 to-transparent p-7">
          {/* style-deviation: the glow marks the one featured item; the operator kept this effect on typo-card-label at Gate 0. */}
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
