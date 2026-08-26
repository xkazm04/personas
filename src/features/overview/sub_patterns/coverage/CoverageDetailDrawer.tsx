// Per-project evidence drawer for the Coverage lane — the full detail behind
// each of the tile's four symbol rows, plus the verbatim debt list.
//
// R3 will add per-debt Dispatch buttons here (coverageTasks.ts prompt
// builders, dedup vs live Fleet sessions) — see the insertion point in the
// debts section below.
import { RelativeTime } from '@/features/shared/components/display/RelativeTime';
import { useTranslation } from '@/i18n/useTranslation';
import { BaseModal } from '@/lib/ui/BaseModal';

import { CoverageStateChip } from './CoverageStateChip';
import type { TileView } from './coverageModel';

function Section({ heading, children }: { heading: string; children: React.ReactNode }) {
  return (
    <section className="flex flex-col gap-2">
      <h3 className="typo-caption font-medium uppercase tracking-wide text-foreground">
        {heading}
      </h3>
      {children}
    </section>
  );
}

export function CoverageDetailDrawer({ view, onClose }: { view: TileView; onClose: () => void }) {
  const { t, tx } = useTranslation();
  const tc = t.overview.registry_coverage;
  const { tile, harvest, practices } = view;
  const map = tile.applied.registryMap;

  return (
    <BaseModal isOpen onClose={onClose} titleId="coverage-detail" size="lg" staggerChildren={false}>
      <div className="flex flex-col gap-5 p-5 max-h-[80vh] overflow-y-auto">
        <div className="flex items-center gap-2">
          <h2 id="coverage-detail" className="typo-title text-foreground flex-1 min-w-0 truncate">
            {tile.projectName}
          </h2>
          {view.inSync && <CoverageStateChip tone="success" label={tc.in_sync} />}
        </div>

        {/* (a) Presence */}
        <Section heading={tc.dim_registry}>
          <div className="flex flex-wrap items-center gap-2">
            {tile.presence.inRegistry ? (
              <CoverageStateChip tone="success" label={tc.state_in_registry} />
            ) : (
              <CoverageStateChip tone="error" label={tc.state_not_in_registry} />
            )}
            {tile.slug !== null && (
              <span className="typo-caption font-mono text-foreground">{tile.slug}</span>
            )}
          </div>
          {tile.presence.domains.length > 0 && (
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="typo-caption text-foreground">{tc.domains_label}</span>
              {tile.presence.domains.map((d) => (
                <span
                  key={d}
                  className="rounded-interactive border border-primary/15 bg-primary/5 px-1.5 py-px typo-caption text-foreground"
                >
                  {d}
                </span>
              ))}
            </div>
          )}
        </Section>

        {/* (b) Extraction — registry half (forged) + app half (harvest ledger) */}
        <Section heading={tc.dim_extracted}>
          <div className="flex flex-col gap-1 typo-body text-foreground">
            {tile.presence.forgedFrom && <span>{tc.forged_detail}</span>}
            {harvest === null ? (
              <span>{tc.state_no_signal}</span>
            ) : harvest.scopesHarvested > 0 ? (
              <span className="inline-flex flex-wrap items-center gap-1.5">
                {tx(tc.harvest_detail, {
                  items: harvest.itemsFound,
                  scopes: harvest.scopesHarvested,
                })}
                <RelativeTime timestamp={harvest.lastHarvestedAt} fallback={tc.state_never} />
              </span>
            ) : (
              <span>{tc.never_harvested}</span>
            )}
          </div>
        </Section>

        {/* (c) Applied — skills table, registry-map breakdown, practices rollup */}
        <Section heading={tc.dim_applied}>
          <h4 className="typo-caption font-medium text-foreground">{tc.drawer_skills_heading}</h4>
          {tile.applied.skillsDetail.length === 0 ? (
            <p className="typo-body text-foreground">{tc.skills_empty}</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="border-b border-primary/10">
                    <th className="text-left typo-caption font-medium text-foreground py-1 pr-3">
                      {tc.col_skill}
                    </th>
                    <th className="text-left typo-caption font-medium text-foreground py-1 pr-3">
                      {tc.col_adopted}
                    </th>
                    <th className="text-left typo-caption font-medium text-foreground py-1 pr-3">
                      {tc.col_lane}
                    </th>
                    <th className="text-left typo-caption font-medium text-foreground py-1">
                      {tc.col_mechanism}
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {tile.applied.skillsDetail.map((s) => (
                    <tr key={s.skill} className="border-b border-primary/5">
                      <td className="typo-caption text-foreground py-1 pr-3">{s.skill}</td>
                      <td
                        className={`typo-caption font-mono py-1 pr-3 ${s.behind ? 'text-status-warning' : 'text-foreground'}`}
                      >
                        {s.adoptedVersion ?? '—'}
                      </td>
                      <td className="typo-caption font-mono text-foreground py-1 pr-3">
                        {s.laneVersion}
                      </td>
                      <td className="typo-caption text-foreground py-1">
                        <span className="rounded-interactive border border-border/60 bg-secondary/40 px-1 py-px font-mono">
                          {s.mechanism}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          <div className="typo-body text-foreground">
            {map === null
              ? tc.map_no_signal
              : !map.exists
                ? tc.map_never
                : tx(tc.map_counts, {
                    conformant: map.conformant,
                    deviation: map.deviation,
                    unknown: map.unknown,
                  })}
            {map?.exists === true && map.digestStale && (
              <span className="text-status-warning"> · {tc.map_digest_stale}</span>
            )}
          </div>

          <div className="typo-body text-foreground">
            {practices === null ? (
              tc.practices_no_signal
            ) : (
              <span className="inline-flex flex-wrap items-center gap-x-2">
                <span>
                  {tx(tc.practices_detail, {
                    adopted: practices.adopted,
                    diverged: practices.diverged,
                  })}
                </span>
                {practices.dispatched > 0 && (
                  <span>{tx(tc.practices_dispatched, { count: practices.dispatched })}</span>
                )}
              </span>
            )}
          </div>
        </Section>

        {/* (d) Freshness — the two clocks side by side */}
        <Section heading={tc.dim_freshness}>
          <div className="flex flex-wrap items-center gap-4 typo-body text-foreground">
            <span className="inline-flex items-center gap-1.5">
              {tc.clock_project}
              <RelativeTime timestamp={view.projectLastAction} fallback={tc.state_never} />
            </span>
            <span className="inline-flex items-center gap-1.5">
              {tc.clock_registry}
              <RelativeTime timestamp={view.registryLastMove} fallback={tc.state_no_signal} />
            </span>
            {view.freshness === 'behind' && (
              <CoverageStateChip tone="warning" label={tc.state_behind} />
            )}
          </div>
        </Section>

        {/* Debts — verbatim, kind + detail. */}
        <Section heading={tc.drawer_debts}>
          {tile.debts.length === 0 ? (
            <p className="typo-body text-foreground">{tc.no_debts}</p>
          ) : (
            <ul className="flex flex-col gap-1.5">
              {tile.debts.map((d, i) => (
                <li key={`${d.kind}-${i}`} className="flex items-start gap-2">
                  <CoverageStateChip tone="error" label={d.kind} />
                  <span className="typo-body text-foreground flex-1 min-w-0">{d.detail}</span>
                  {/* R3 insertion point: a per-debt Dispatch button lands here —
                      coverageTasks.ts prompt builder per debt kind, dedup key
                      `registry:cov:<debt>:<project>`, syncBeforeDispatch gate,
                      usePassportFleetSessions ink. */}
                </li>
              ))}
            </ul>
          )}
        </Section>
      </div>
    </BaseModal>
  );
}
