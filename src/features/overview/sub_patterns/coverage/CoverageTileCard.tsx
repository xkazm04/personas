// One project's coverage tile — four symbol rows (plan D4 vocabulary) plus
// the earned health header (plan D5: "in sync" requires all four dimensions
// to carry signal AND zero debts; absence of signal is never health).
import { CircleCheck, Clock, Library, Pickaxe, Puzzle } from 'lucide-react';
import type { ReactNode } from 'react';

import { RelativeTime } from '@/features/shared/components/display/RelativeTime';
import { useTranslation } from '@/i18n/useTranslation';

import type { TileView } from './coverageModel';

type ChipTone = 'success' | 'info' | 'warning' | 'error' | 'muted';

// Same pattern as HierarchyStatusChip: semantic tokens only, keyed at module
// scope so every chip in the lane draws from one palette.
const CHIP_CLASSES: Record<ChipTone, string> = {
  success: 'border-status-success/30 bg-status-success/10 text-status-success',
  info: 'border-status-info/30 bg-status-info/10 text-status-info',
  warning: 'border-status-warning/30 bg-status-warning/10 text-status-warning',
  error: 'border-status-error/30 bg-status-error/10 text-status-error',
  muted: 'border-border/60 bg-secondary/40 text-foreground/60',
};

export function CoverageStateChip({ tone, label }: { tone: ChipTone; label: string }) {
  return (
    <span
      className={`inline-flex items-center whitespace-nowrap rounded-interactive border px-1.5 py-0.5 typo-caption ${CHIP_CLASSES[tone]}`}
    >
      {label}
    </span>
  );
}

function DimensionRow({
  icon,
  label,
  chip,
  detail,
}: {
  icon: ReactNode;
  label: string;
  chip: ReactNode;
  detail: ReactNode;
}) {
  return (
    <div className="flex items-start gap-2">
      <span className="mt-0.5 flex-shrink-0 text-foreground" aria-hidden>
        {icon}
      </span>
      <div className="flex-1 min-w-0 flex flex-col gap-0.5">
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="typo-caption text-foreground">{label}</span>
          {chip}
        </div>
        <div className="typo-caption text-foreground min-w-0">{detail}</div>
      </div>
    </div>
  );
}

export function CoverageTileCard({ view, onOpen }: { view: TileView; onOpen: () => void }) {
  const { t, tx } = useTranslation();
  const tc = t.overview.registry_coverage;
  const { tile, harvest, practices } = view;

  // -- Registry (presence) ---------------------------------------------------
  const registryChip = tile.presence.inRegistry ? (
    <CoverageStateChip tone="success" label={tc.state_in_registry} />
  ) : (
    <CoverageStateChip tone="error" label={tc.state_not_in_registry} />
  );
  const registryDetail = tile.presence.inRegistry ? (
    <span className="flex flex-wrap items-center gap-1">
      {tile.presence.domains.map((d) => (
        <span
          key={d}
          className="rounded-interactive border border-primary/15 bg-primary/5 px-1 py-px typo-caption text-foreground"
        >
          {d}
        </span>
      ))}
    </span>
  ) : (
    <span>{tc.state_no_signal}</span>
  );

  // -- Extracted -------------------------------------------------------------
  const harvestEver = harvest !== null && harvest.scopesHarvested > 0;
  const extractionChip = tile.presence.forgedFrom ? (
    <CoverageStateChip tone="info" label={tc.state_forged} />
  ) : harvestEver ? (
    <CoverageStateChip tone="success" label={tc.state_harvested} />
  ) : harvest === null ? (
    <CoverageStateChip tone="muted" label={tc.state_no_signal} />
  ) : (
    <CoverageStateChip tone="muted" label={tc.state_never} />
  );
  const extractionDetail = (
    <span className="inline-flex flex-wrap items-center gap-1">
      {tile.presence.forgedFrom && <span>{tc.forged_detail}</span>}
      {harvestEver ? (
        <span className="inline-flex items-center gap-1">
          {tx(tc.harvest_detail, { items: harvest.itemsFound, scopes: harvest.scopesHarvested })}
          <RelativeTime timestamp={harvest.lastHarvestedAt} fallback={tc.state_never} />
        </span>
      ) : harvest === null ? (
        <span>{tc.state_no_signal}</span>
      ) : (
        <span>{tc.never_harvested}</span>
      )}
    </span>
  );

  // -- Applied ---------------------------------------------------------------
  const map = tile.applied.registryMap;
  const neverMapped = map !== null && !map.exists;
  const appliedChip = neverMapped ? (
    <CoverageStateChip tone="error" label={tc.state_never_mapped} />
  ) : view.appliedSignal ? (
    <CoverageStateChip tone="success" label={tc.state_applied} />
  ) : (
    <CoverageStateChip tone="muted" label={tc.state_no_signal} />
  );
  const appliedParts: ReactNode[] = [
    <span key="skills">
      {tx(tc.skills_detail_row, { count: tile.applied.skillsAdopted })}
      {tile.applied.skillsBehind > 0 && (
        <span className="text-status-warning">
          {' '}
          {tx(tc.skills_behind, { count: tile.applied.skillsBehind })}
        </span>
      )}
    </span>,
    <span key="map">
      {map === null
        ? tc.map_no_signal
        : map.exists
          ? tx(tc.map_counts, {
              conformant: map.conformant,
              deviation: map.deviation,
              unknown: map.unknown,
            })
          : tc.map_never}
    </span>,
    <span key="practices">
      {practices !== null
        ? tx(tc.practices_detail, { adopted: practices.adopted, diverged: practices.diverged })
        : tc.practices_no_signal}
    </span>,
  ];

  // -- Freshness -------------------------------------------------------------
  const freshnessChip =
    view.freshness === 'never' ? (
      <CoverageStateChip tone="muted" label={tc.state_never} />
    ) : view.freshness === 'behind' ? (
      <CoverageStateChip tone="warning" label={tc.state_behind} />
    ) : view.freshnessSignal ? (
      <CoverageStateChip tone="success" label={tc.state_synced} />
    ) : (
      <CoverageStateChip tone="muted" label={tc.state_no_signal} />
    );
  const freshnessDetail = (
    <span className="inline-flex flex-wrap items-center gap-x-2">
      <span className="inline-flex items-center gap-1">
        {tc.clock_project}
        <RelativeTime timestamp={view.projectLastAction} fallback={tc.state_never} />
      </span>
      <span className="inline-flex items-center gap-1">
        {tc.clock_registry}
        <RelativeTime timestamp={view.registryLastMove} fallback={tc.state_no_signal} />
      </span>
    </span>
  );

  return (
    <button
      type="button"
      onClick={onOpen}
      aria-label={tx(tc.tile_open_aria, { name: tile.projectName })}
      className="text-left rounded-card border border-primary/15 bg-secondary/20 p-3 flex flex-col gap-2.5 hover:border-primary/30 focus-visible:outline-2 focus-visible:outline-primary transition-colors"
    >
      <div className="flex items-center gap-2">
        <span className="typo-body text-foreground truncate flex-1 min-w-0">
          {tile.projectName}
        </span>
        {tile.debts.length > 0 ? (
          <CoverageStateChip
            tone="error"
            label={
              tile.debts.length === 1
                ? tc.debt_badge_one
                : tx(tc.debt_badge_other, { count: tile.debts.length })
            }
          />
        ) : view.inSync ? (
          <span className="inline-flex items-center gap-1 text-status-success typo-caption">
            <CircleCheck className="w-3.5 h-3.5" aria-hidden />
            {tc.in_sync}
          </span>
        ) : null}
      </div>

      <DimensionRow
        icon={<Library className="w-3.5 h-3.5" />}
        label={tc.dim_registry}
        chip={registryChip}
        detail={registryDetail}
      />
      <DimensionRow
        icon={<Pickaxe className="w-3.5 h-3.5" />}
        label={tc.dim_extracted}
        chip={extractionChip}
        detail={extractionDetail}
      />
      <DimensionRow
        icon={<Puzzle className="w-3.5 h-3.5" />}
        label={tc.dim_applied}
        chip={appliedChip}
        detail={
          <span className="inline-flex flex-wrap items-center gap-x-2">{appliedParts}</span>
        }
      />
      <DimensionRow
        icon={<Clock className="w-3.5 h-3.5" />}
        label={tc.dim_freshness}
        chip={freshnessChip}
        detail={freshnessDetail}
      />
    </button>
  );
}
