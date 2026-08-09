// Level 1 — the "ember matrix": skills ranked by recency-weighted heat
// (hottest first — the ranking IS the story), one ember dot per workspace
// project. Fresh visual direction, deliberately not the Registry tab's
// contribution field. Click a cell or row → the skill tree (Level 2).
//
// PROTOTYPE MODE (throwaway): `TraceOverview` is temporarily a variant
// switcher over Baseline / Beacon Board / Ledger. Consolidation deletes the
// switcher and the losing variants (prototype skill, Phase 5).
import { useState } from 'react';

import { Flame, Info } from 'lucide-react';

import { IllustratedEmptyState } from '@/features/shared/components/display/IllustratedEmptyState';
import { Tooltip } from '@/features/shared/components/display/Tooltip';
import { useTranslation } from '@/i18n/useTranslation';

import { TraceBeaconBoard } from './TraceBeaconBoard';
import { TraceEmberCell } from './TraceEmberCell';
import { TraceGhosts } from './TraceGhosts';
import { TraceLedger } from './TraceLedger';
import type { HeatTier, TraceModel } from './traceTypes';

export interface TraceOverviewProps {
  model: TraceModel;
  onSelectSkill: (skill: string) => void;
  onOpenInfo: (skill: string) => void;
}

const TIER_SWATCH: Record<HeatTier, string> = {
  hot: 'bg-primary opacity-90',
  warm: 'bg-primary opacity-60',
  cool: 'bg-primary opacity-30',
  cold: 'border border-dashed border-foreground/40',
  absent: 'bg-foreground/15',
};

export function TraceOverviewBaseline({ model, onSelectSkill, onOpenInfo }: TraceOverviewProps) {
  const { t, tx } = useTranslation();
  const showGhost = model.loading && model.skills.length === 0;
  const settledEmpty = !model.loading && model.skills.length === 0;

  return (
    <div className="flex flex-col min-h-0 h-full">
      {/* chrome renders always (law 1) */}
      <div className="overflow-auto flex-1 min-h-0 pr-2">
        <table className="border-separate border-spacing-y-1">
          <thead>
            <tr>
              <th className="sticky left-0 bg-background text-left typo-caption text-foreground font-normal pr-3">
                {tx(t.plugins.dev_tools.trace_skills_count, { count: model.skills.length })}
              </th>
              {model.projects.map((p) => (
                <th key={p.id} className="typo-caption text-foreground font-normal px-1 max-w-[72px]">
                  <span className="block truncate" title={p.name}>{p.name}</span>
                </th>
              ))}
              <th aria-hidden className="w-full" />
            </tr>
          </thead>
          <tbody>
            {showGhost ? (
              <tr>
                <td colSpan={model.projects.length + 2}>
                  <TraceGhosts columns={model.projects.length} />
                </td>
              </tr>
            ) : (
              model.skills.map((s) => {
                const Icon = s.visual?.icon ?? Flame;
                return (
                  <tr key={s.name} className="group">
                    <td className="sticky left-0 bg-background pr-3">
                      <div className="flex items-center gap-2 min-w-52">
                        <button
                          type="button"
                          onClick={() => onSelectSkill(s.name)}
                          className="flex items-center gap-2 min-w-0 hover:text-primary transition-colors"
                        >
                          <Icon size={14} style={s.visual ? { color: s.visual.color } : undefined} className="shrink-0" />
                          <span className="typo-body truncate">{s.name}</span>
                        </button>
                        {/* row heat bar — the ranking, made visible */}
                        <div className="flex-1 min-w-8 h-1 rounded-full bg-secondary overflow-hidden">
                          <div
                            className="h-full rounded-full bg-primary/70"
                            style={{ width: `${Math.min(100, Math.round((s.totalHeat / Math.max(1, model.projects.length)) * 100))}%` }}
                          />
                        </div>
                        {/* version — its own aligned column, not part of the name */}
                        <span className="typo-caption text-foreground tabular-nums shrink-0 w-10 text-right px-1 rounded-interactive bg-secondary/60">
                          v{s.libraryVersion ?? '1.0'}
                        </span>
                        <button
                          type="button"
                          onClick={() => onOpenInfo(s.name)}
                          aria-label={t.plugins.dev_tools.trace_open_info}
                          className="opacity-0 group-hover:opacity-100 text-foreground hover:text-foreground transition-opacity"
                        >
                          <Info size={13} />
                        </button>
                      </div>
                    </td>
                    {model.projects.map((p) => (
                      <td key={p.id} className="text-center">
                        <TraceEmberCell
                          cell={model.cell(s.name, p.id)}
                          accent={s.visual?.color ?? null}
                          onClick={() => onSelectSkill(s.name)}
                        />
                      </td>
                    ))}
                    <td aria-hidden />
                  </tr>
                );
              })
            )}
          </tbody>
        </table>

        {settledEmpty && (
          <div className="py-10">
            <IllustratedEmptyState
              variant="heatmap"
              heading={t.plugins.dev_tools.trace_empty_title}
              description={t.plugins.dev_tools.trace_empty_hint}
            />
          </div>
        )}
      </div>

      {/* tier legend */}
      <div className="flex items-center gap-4 pt-2 border-t border-border/50">
        {(['hot', 'warm', 'cool', 'cold', 'absent'] as HeatTier[]).map((tier) => (
          <Tooltip key={tier} content={t.plugins.dev_tools[`trace_tier_${tier}_hint` as const]}>
            <span className="inline-flex items-center gap-1.5 typo-caption text-foreground">
              <span className={`inline-block w-2.5 h-2.5 rounded-full ${TIER_SWATCH[tier]}`} />
              {t.plugins.dev_tools[`trace_tier_${tier}` as const]}
            </span>
          </Tooltip>
        ))}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Throwaway variant switcher (prototype skill). Deleted at consolidation.
// Hardcoded labels are deliberate — the switcher never ships.
// ---------------------------------------------------------------------------
const OVERVIEW_VARIANTS = [
  { id: 'baseline', label: 'Ember Matrix', hint: 'cross-project heat scan' },
  { id: 'beacons', label: 'Beacon Board', hint: 'one tile per skill' },
  { id: 'ledger', label: 'Ledger', hint: 'audited register rows' },
] as const;
type OverviewVariant = (typeof OVERVIEW_VARIANTS)[number]['id'];

export function TraceOverview(props: TraceOverviewProps) {
  const [variant, setVariant] = useState<OverviewVariant>('baseline');
  return (
    <div className="flex flex-col min-h-0 h-full gap-2">
      <div className="flex items-center gap-1 shrink-0">
        {OVERVIEW_VARIANTS.map((v) => (
          <button
            key={v.id}
            type="button"
            data-testid={`trace-variant-${v.id}`}
            onClick={() => setVariant(v.id)}
            className={`px-2 py-1 rounded-interactive typo-caption transition-colors ${variant === v.id ? 'bg-primary/15 text-primary' : 'bg-secondary/50 text-foreground hover:bg-secondary'}`}
            title={v.hint}
          >
            {v.label}
          </button>
        ))}
      </div>
      <div className="flex-1 min-h-0">
        {variant === 'beacons' ? <TraceBeaconBoard {...props} />
          : variant === 'ledger' ? <TraceLedger {...props} />
          : <TraceOverviewBaseline {...props} />}
      </div>
    </div>
  );
}
