import { Dot } from '@/features/shared/components/kit';
import { Tooltip } from '@/features/shared/components/display/Tooltip';
import type { Release } from '@/data/releases';
import type { ReleasesTranslation } from './i18n/useReleasesTranslation';
import { ITEM_TYPE_MARK, RELEASE_STATUS_TONE, TONE_CHIP } from './releaseTones';

/**
 * One shipped release: name, version, state and date, a summary, then its items as a
 * bulleted list - each bullet the kit's `Dot`, toned and shaped for the item's kind
 * (owner, 2026-10-03: "For each release row design rather themed bulletpoint instead of
 * spark icon"). The kind is still named: the `Tooltip` says it on hover and the dot's
 * wrapper carries it as an accessible name, which is what the dropped lucide icon's
 * `aria-label` used to do - a 9px dot on its own would say nothing to either reader.
 */
export function BundledReleaseCard({ release, t }: { release: Release; t: ReleasesTranslation }) {
  const i18n = t.releases[release.version];
  const items = i18n?.items;
  return (
    <section className="rounded-modal border border-primary/8 bg-gradient-to-br from-primary/2 to-transparent p-5">
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
          const bullet = ITEM_TYPE_MARK[item.type];
          const typeLabel = t.type[item.type];
          const content = items?.[item.id];
          return (
            <li key={item.id} className="flex items-start gap-2.5">
              <Tooltip content={typeLabel}>
                {/* The dot itself is aria-hidden (it is a glyph, not a word); the kind is
                    named here so a reader who cannot see the tone still gets it.

                    `flex` is load-bearing, not decoration: Dot is an inline-block, so in a
                    plain span it sits on the BASELINE of a line box that inherits typo-body's
                    1.65 leading - measured at 1440px, dot centre y=41 against a cap centre of
                    y=35, a bullet visibly hanging off the bottom of its line, and the span's
                    own line box padded the list's row pitch to 39px. As a flex item the span
                    is its own 9px box (pitch 35.5px) and mt-2.5 lands the dot at y=35. */}
                <span role="img" aria-label={typeLabel} className="mt-2.5 flex flex-none">
                  <Dot tone={bullet.tone} glyph={bullet.glyph} />
                </span>
              </Tooltip>
              <span className="typo-body text-foreground">{content?.title ?? `[${release.version}.${item.id}]`}</span>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
