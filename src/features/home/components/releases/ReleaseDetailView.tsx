/**
 * Standard changelog view for a single release.
 *
 * Items are grouped by `type` (feature / fix / security / ...). Within each
 * group they keep their `releases.json` ordering — newest entries should be
 * appended to the end of `items` so they appear last under their type. This
 * is consistent with how `/research` Phase 12 will append accepted findings.
 */
import type { Release, ReleaseItem, ReleaseItemType } from '@/data/releases';
import { RELEASE_STATUS_META, RELEASE_TYPE_META } from '@/data/releases';

interface ReleaseDetailViewProps {
  release: Release;
}

const TYPE_ORDER: ReleaseItemType[] = ['feature', 'fix', 'security', 'breaking', 'docs', 'chore'];

function ItemRow({ item }: { item: ReleaseItem }) {
  const typeMeta = RELEASE_TYPE_META[item.type];
  const isInProgress = item.status === 'in_progress';

  return (
    <div className="animate-fade-slide-in group relative rounded-xl border border-primary/6 bg-gradient-to-br from-primary/[0.02] to-transparent p-4 transition-all duration-200 hover:border-primary/12 hover:bg-primary/[0.03]">
      <div className="flex items-start gap-3">
        <span
          className={[
            'shrink-0 rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider',
            typeMeta.badgeBg,
            typeMeta.badgeText,
            typeMeta.badgeBorder,
          ].join(' ')}
        >
          {typeMeta.label}
        </span>
        <div className="flex-1 min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            {/* Title: theme-accent color + subtle glow for highlight (see CLAUDE.md UI Conventions). */}
            <h3 className="typo-heading text-primary text-[14px] [text-shadow:_0_0_10px_color-mix(in_oklab,var(--primary)_35%,transparent)]">
              {item.title}
            </h3>
            {isInProgress && (
              <span className="rounded-full border border-cyan-500/20 bg-cyan-500/10 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wider text-cyan-400">
                In Progress
              </span>
            )}
            {item.added_at && (
              <span className="font-mono text-[10px] text-foreground">{item.added_at}</span>
            )}
          </div>
          {item.description && (
            <p className="typo-body mt-1 text-[12px] leading-relaxed text-foreground">{item.description}</p>
          )}
          {item.source && (
            <p className="mt-1.5 font-mono text-[10px] text-foreground">↪ {item.source}</p>
          )}
        </div>
      </div>
    </div>
  );
}

export default function ReleaseDetailView({ release }: ReleaseDetailViewProps) {
  const statusMeta = RELEASE_STATUS_META[release.status];

  // Group items by type, preserving the type ordering above and the within-type
  // source-array order.
  const groups = TYPE_ORDER
    .map((type) => ({
      type,
      meta: RELEASE_TYPE_META[type],
      items: release.items.filter((item) => item.type === type),
    }))
    .filter((g) => g.items.length > 0);

  const totalItems = release.items.length;

  return (
    <div className="relative">
      {/* Background mesh — same idiom as HomeRoadmapView for visual consistency */}
      <div className="absolute inset-0 overflow-hidden pointer-events-none">
        <div className="absolute top-[-10%] left-[20%] w-[400px] h-[400px] bg-cyan-500/4 blur-[120px] rounded-full" />
        <div className="absolute bottom-[0%] right-[10%] w-[300px] h-[300px] bg-purple-500/3 blur-[100px] rounded-full" />
      </div>

      <div className="w-full max-w-3xl mx-auto space-y-6 relative z-10">
        {/* Release header */}
        <div className="animate-fade-slide-in space-y-2">
          <div className="flex flex-wrap items-baseline gap-3">
            {/* Release name = primary title; uses theme accent + glow per CLAUDE.md UI Conventions. */}
            <h2 className="typo-heading text-primary text-[20px] font-semibold [text-shadow:_0_0_14px_color-mix(in_oklab,var(--primary)_35%,transparent)]">
              {release.label ?? release.version}
            </h2>
            <span className="font-mono text-[12px] text-foreground">{release.version}</span>
            <span
              className={[
                'rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider',
                statusMeta.badgeBg,
                statusMeta.badgeText,
                statusMeta.badgeBorder,
              ].join(' ')}
            >
              {statusMeta.label}
            </span>
            {release.released_at && (
              <span className="font-mono text-[11px] text-foreground">{release.released_at}</span>
            )}
          </div>
          {release.summary && (
            <p className="typo-body text-[13px] leading-relaxed text-foreground">{release.summary}</p>
          )}
        </div>

        {totalItems === 0 ? (
          <div className="rounded-xl border border-dashed border-primary/10 bg-primary/[0.02] p-8 text-center">
            <p className="typo-body text-[12px] text-foreground">
              No items logged for this release yet.
            </p>
          </div>
        ) : (
          <div className="space-y-6">
            {groups.map((group) => (
              <section key={group.type} className="space-y-2">
                {/* Group label is structural — keeps tracking/uppercase but uses primary accent for hierarchy. */}
                <header className="flex items-center gap-2">
                  <h3 className="typo-heading text-[12px] font-semibold uppercase tracking-wider text-primary">
                    {group.meta.label}
                  </h3>
                  <span className="font-mono text-[11px] text-foreground">{group.items.length}</span>
                </header>
                <div className="space-y-2">
                  {group.items.map((item) => (
                    <ItemRow key={item.id} item={item} />
                  ))}
                </div>
              </section>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
