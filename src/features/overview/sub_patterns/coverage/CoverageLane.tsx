// Coverage lane — Project × registry-status grid (registry-coverage-ui R2).
//
// Loading-v2 laws: the header chrome always renders once a registry is
// resolved; geometry-matched ghost tiles appear (delayed) ONLY while loading
// with no warm data; a failed refresh keeps the warm grid and shows an error
// banner with retry beside it — failure is never rendered as emptiness.
import { GitBranch, RefreshCw, TriangleAlert } from 'lucide-react';
import { useState } from 'react';

import { syncRegistryClone } from '@/api/devTools/devTools';
import AsyncButton from '@/features/shared/components/buttons/AsyncButton';
import Button from '@/features/shared/components/buttons/Button';
import { IllustratedEmptyState } from '@/features/shared/components/display/IllustratedEmptyState';
import { RelativeTime } from '@/features/shared/components/display/RelativeTime';
import { useTranslation } from '@/i18n/useTranslation';
import { useToastStore } from '@/stores/toastStore';

import { CoverageDetailDrawer } from './CoverageDetailDrawer';
import { CoverageTileCard } from './CoverageTileCard';
import type { TileView } from './coverageModel';
import { useRegistryCoverage } from './useRegistryCoverage';

/** Calm, static ghost tile (never pulsing — loading doctrine law 3) matching
 *  the real tile's geometry: name line + four dimension rows. */
function GhostTile() {
  const bar = 'bg-primary/[0.06]';
  return (
    <div
      aria-hidden="true"
      className="rounded-card border border-primary/10 bg-secondary/10 p-3 flex flex-col gap-3"
    >
      <div className={`h-[0.9em] w-32 rounded ${bar}`} />
      {[0, 1, 2, 3].map((i) => (
        <div key={i} className="flex items-center gap-2">
          <div className={`w-3.5 h-3.5 rounded ${bar}`} />
          <div className={`h-[0.7em] w-20 rounded ${bar}`} />
          <div className={`h-[0.7em] w-28 rounded ${bar}`} />
        </div>
      ))}
    </div>
  );
}

export function CoverageLane() {
  const { t, tx } = useTranslation();
  const tc = t.overview.registry_coverage;
  const tr = t.plugins.dev_tools.registry;
  const addToast = useToastStore((s) => s.addToast);
  const { registry, othersCount, data, loading, error, refetch } = useRegistryCoverage();
  const [openTile, setOpenTile] = useState<TileView | null>(null);

  // No paired registry: point at the wiring surface (Dev Tools → Workspaces).
  if (!registry) {
    return (
      <div className="flex-1 min-h-0 flex items-center justify-center p-6">
        <IllustratedEmptyState
          variant="routines"
          heading={tc.no_registry_title}
          description={tc.no_registry_desc}
        />
      </div>
    );
  }

  const onSync = async () => {
    try {
      const r = await syncRegistryClone(registry.clonePath);
      addToast(
        r.state === 'up_to_date'
          ? tr.sync_current
          : tx(r.commits === 1 ? tr.sync_pulled_one : tr.sync_pulled_other, { count: r.commits }),
        'success',
      );
      refetch();
    } catch (e) {
      const detail = e instanceof Error ? e.message.split('\n')[0] : String(e);
      addToast(`${tr.sync_failed} ${detail}`, 'error');
    }
  };

  const coverage = data?.coverage ?? null;
  const registryName = coverage?.registryName ?? registry.fullName;
  const headSha = coverage?.headSha ?? registry.sha;

  return (
    <div className="flex-1 min-h-0 flex flex-col gap-3 overflow-y-auto">
      {/* Header card — permanent chrome, renders warm or cold. */}
      <div className="flex-shrink-0 rounded-card border border-primary/15 bg-secondary/20 p-3 flex flex-col gap-2">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
          <GitBranch className="w-4 h-4 text-foreground" aria-hidden />
          <span className="typo-body font-medium text-foreground">{registryName}</span>
          {headSha !== null && (
            <span className="inline-flex items-center gap-1 rounded-interactive border border-border/60 bg-secondary/40 px-1.5 py-0.5 typo-caption font-mono text-foreground">
              {headSha}
              {coverage?.dirty === true && (
                <span className="text-status-warning">· {tc.dirty_marker}</span>
              )}
            </span>
          )}
          {coverage?.generatedAt != null && (
            <span className="inline-flex items-center gap-1 typo-caption text-foreground">
              {tc.catalog_generated}
              <RelativeTime timestamp={coverage.generatedAt} />
            </span>
          )}
          <span className="ml-auto">
            <AsyncButton size="sm" variant="secondary" icon={<RefreshCw className="w-3.5 h-3.5" aria-hidden />} onClick={onSync}>
              {tc.sync_action}
            </AsyncButton>
          </span>
        </div>

        {coverage !== null && coverage.laneDates.length > 0 && (
          <div className="flex flex-wrap items-center gap-2">
            {coverage.laneDates.map((l) => (
              <span
                key={l.lane}
                className="inline-flex items-center gap-1 rounded-interactive border border-primary/15 bg-primary/5 px-1.5 py-0.5 typo-caption text-foreground"
              >
                {l.lane}
                <RelativeTime timestamp={l.lastCommit} fallback={tc.lane_never} />
              </span>
            ))}
          </div>
        )}

        {othersCount > 0 && (
          /* muted-ok: structural qualifier note, not body content */
          <p className="typo-caption text-foreground/60">
            {tx(tc.multiple_note, { name: registryName })}
          </p>
        )}

        {coverage !== null && coverage.warnings.length > 0 && (
          <p className="typo-caption text-status-warning">
            {tx(tc.warnings_note, { count: coverage.warnings.length })}
          </p>
        )}
      </div>

      {/* Failure keeps the warm grid; the banner names it and offers retry. */}
      {error !== null && (
        <div className="flex-shrink-0 rounded-card border border-status-error/30 bg-status-error/10 p-3 flex items-center gap-3">
          <TriangleAlert className="w-4 h-4 text-status-error flex-shrink-0" aria-hidden />
          <span className="typo-body text-foreground flex-1 min-w-0">
            {tx(tc.fetch_failed, { error })}
          </span>
          <Button size="sm" variant="secondary" onClick={refetch}>
            {t.common.retry}
          </Button>
        </div>
      )}

      {coverage !== null && !coverage.source.present ? (
        <div className="flex-1 min-h-0 flex items-center justify-center p-6">
          <IllustratedEmptyState
            variant="routines"
            heading={tc.not_registry_title}
            description={coverage.source.reason ?? undefined}
          />
        </div>
      ) : (
        <>
          {/* Tile grid — ghosts only while loading with nothing warm. */}
          {data === null && loading ? (
            <div
              className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3 animate-fade-in"
              style={{ animationDelay: '150ms' }}
            >
              {[0, 1, 2, 3, 4, 5].map((i) => (
                <GhostTile key={i} />
              ))}
            </div>
          ) : data !== null ? (
            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
              {data.tiles.map((view) => (
                <CoverageTileCard
                  key={view.tile.projectId}
                  view={view}
                  onOpen={() => setOpenTile(view)}
                />
              ))}
            </div>
          ) : null}

          {/* Registry-only slugs — rendered, never guessed away (plan D3). */}
          {coverage !== null && coverage.registryOnly.length > 0 && (
            <div className="flex-shrink-0 flex flex-col gap-2">
              <h3 className="typo-caption font-medium uppercase tracking-wide text-foreground">
                {tc.registry_only_heading}
              </h3>
              <ul className="flex flex-col gap-1.5">
                {coverage.registryOnly.map((r) => (
                  <li
                    key={r.slug}
                    className="rounded-card border border-primary/10 bg-secondary/10 px-3 py-2 flex flex-wrap items-center gap-2"
                  >
                    <span className="typo-body font-mono text-foreground">{r.slug}</span>
                    {r.domains.map((d) => (
                      <span
                        key={d}
                        className="rounded-interactive border border-primary/15 bg-primary/5 px-1 py-px typo-caption text-foreground"
                      >
                        {d}
                      </span>
                    ))}
                    {/* muted-ok: structural qualifier note beside the slug */}
                    <span className="typo-caption text-foreground/60 ml-auto">
                      {tc.name_unmatched}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </>
      )}

      {openTile !== null && (
        <CoverageDetailDrawer view={openTile} onClose={() => setOpenTile(null)} />
      )}
    </div>
  );
}
