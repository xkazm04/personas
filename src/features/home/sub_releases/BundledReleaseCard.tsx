import { Tooltip } from '@/features/shared/components/display/Tooltip';
import type { Release } from '@/data/releases';
import type { ReleasesTranslation } from './i18n/useReleasesTranslation';
import { ITEM_TYPE_GLYPH, RELEASE_STATUS_TONE, TONE_CHIP, TONE_TEXT } from './releaseTones';

/** One shipped release: name, version, state and date, a summary, then its
 * items, each marked by a glyph for its kind instead of a repeated text chip. */
export function BundledReleaseCard({ release, t }: { release: Release; t: ReleasesTranslation }) {
  const i18n = t.releases[release.version];
  const items = i18n?.items;
  return (
    <section className="rounded-card border border-card-border bg-card-bg p-5">
      <div className="flex flex-wrap items-baseline gap-3">
        <h3 className="typo-title-lg">{i18n?.label ?? release.version}</h3>
        <span className="typo-code text-foreground">{release.version}</span>
        <span className={`rounded-full border px-2 typo-label ${TONE_CHIP[RELEASE_STATUS_TONE[release.status]]}`}>
          {t.status[release.status]}
        </span>
        {release.released_at && <span className="typo-caption tabular-nums">{release.released_at}</span>}
      </div>
      {i18n?.summary && <p className="typo-body mt-2 text-foreground">{i18n.summary}</p>}
      <ul className="mt-4 grid gap-x-8 gap-y-2 lg:grid-cols-2">
        {release.items.map((item) => {
          const glyph = ITEM_TYPE_GLYPH[item.type];
          const Icon = glyph.icon;
          const typeLabel = t.type[item.type];
          const content = items?.[item.id];
          return (
            <li key={item.id} className="flex items-start gap-3">
              <Tooltip content={typeLabel}>
                <Icon role="img" aria-label={typeLabel} className={`mt-1 h-4 w-4 shrink-0 ${TONE_TEXT[glyph.tone]}`} />
              </Tooltip>
              <span className="typo-body text-foreground">{content?.title ?? `[${release.version}.${item.id}]`}</span>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
