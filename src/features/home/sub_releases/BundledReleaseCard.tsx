import { RELEASE_STATUS_META, RELEASE_TYPE_META, type Release } from '@/data/releases';
import type { ReleasesTranslation } from './i18n/useReleasesTranslation';

/** Compact card for one shipped release: header + summary + flat item list. */
export function BundledReleaseCard({ release, t }: { release: Release; t: ReleasesTranslation }) {
  const meta = RELEASE_STATUS_META[release.status];
  const i18n = t.releases[release.version];
  const items = i18n?.items;
  return (
    <section className="rounded-modal border border-primary/8 bg-gradient-to-br from-primary/[0.02] to-transparent p-5">
      <div className="flex flex-wrap items-baseline gap-3">
        <h3 className="typo-heading text-primary [text-shadow:_0_0_12px_color-mix(in_oklab,var(--primary)_32%,transparent)]">
          {i18n?.label ?? release.version}
        </h3>
        <span className="font-mono text-xs text-foreground">{release.version}</span>
        <span className={['rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider', meta.badgeBg, meta.badgeText, meta.badgeBorder].join(' ')}>
          {t.status[release.status]}
        </span>
        {release.released_at && <span className="font-mono text-[11px] text-foreground">{release.released_at}</span>}
      </div>
      {i18n?.summary && <p className="typo-body mt-2 text-[13px] text-foreground">{i18n.summary}</p>}
      <ul className="mt-3 space-y-1.5">
        {release.items.map((item) => {
          const typeMeta = RELEASE_TYPE_META[item.type];
          const content = items?.[item.id];
          return (
            <li key={item.id} className="flex items-start gap-2.5">
              <span className={['mt-0.5 shrink-0 rounded-full border px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wider', typeMeta.badgeBg, typeMeta.badgeText, typeMeta.badgeBorder].join(' ')}>
                {t.type[item.type]}
              </span>
              <span className="typo-body text-[13px] text-foreground">{content?.title ?? `[${release.version}.${item.id}]`}</span>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
