import { RevealItem } from '@/features/shared/components/display/RevealItem';
import type { ReleasesTranslation } from './i18n/useReleasesTranslation';
import type { DisplayItem } from './roadmapItems';
import { ITEM_STATUS_TONE, TONE_FILL, TONE_TEXT, type RevealTracker } from './releaseTones';

/** The featured card: the one roadmap item in progress, set apart from the lanes. */
export function RoadmapHero({ item, enter, t }: { item: DisplayItem; enter: RevealTracker; t: ReleasesTranslation }) {
  const tone = ITEM_STATUS_TONE[item.status];
  return (
    <RevealItem revealId={item.id} order={0} hasEntered={enter.hasEntered} markEntered={enter.markEntered}>
      <article>
        <div className="mb-3 flex flex-wrap items-center gap-3">
          <span className="flex items-center gap-2">
            <span className={`relative h-2.5 w-2.5 rounded-full ${TONE_FILL[tone]}`}>
              {/* The ping is the page's only motion: work is happening on this item. */}
              {item.status === 'in_progress' && (
                <span className={`absolute inset-0 rounded-full opacity-40 animate-ping ${TONE_FILL[tone]}`} />
              )}
            </span>
            <span className={`typo-eyebrow ${TONE_TEXT[tone]}`}>{t.itemStatus[item.status]}</span>
          </span>
          <span className="typo-caption">#{item.sort_order} · {t.priority[item.priority]}</span>
        </div>
        <div className="rounded-card border border-role-highlight/30 bg-gradient-to-br from-role-highlight/10 to-transparent p-7">
          {/* style-deviation: the glow marks the one featured item; the operator kept this effect on typo-card-label at Gate 0. */}
          <h2 className="typo-title-lg [text-shadow:_0_0_18px_color-mix(in_oklab,var(--primary)_38%,transparent)]">
            {item.title}
          </h2>
          {item.description && (
            <p className="typo-body-lg mt-3 max-w-prose text-foreground">{item.description}</p>
          )}
        </div>
      </article>
    </RevealItem>
  );
}
