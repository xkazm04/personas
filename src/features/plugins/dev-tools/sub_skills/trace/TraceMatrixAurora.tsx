// RESTYLE "Aurora" — the Ember Matrix as an atmosphere. Same view mode as
// the baseline (skills × projects ember grid, heat-ranked) finished as a
// night-sky instrument: hot embers GLOW (static drop-shadow, no loops), each
// row carries its skill's accent as a gradient trail, and a faint radial
// wash from the hottest skill's colour grounds the whole surface.
import { Flame } from 'lucide-react';

import { Tooltip } from '@/features/shared/components/display/Tooltip';
import { useTranslation } from '@/i18n/useTranslation';

import { TraceGhosts } from './TraceGhosts';
import type { TraceOverviewProps } from './TraceOverview';
import type { TraceCell } from './traceTypes';

const BOX = 32;

/** Glowing ember — the baseline cell plus a heat-scaled halo. */
function AuroraCell({ cell, accent, onClick, label }: {
  cell: TraceCell; accent: string | null; onClick: () => void; label: string;
}) {
  const c = BOX / 2;
  const r = Math.min(12, 4.5 + 2.2 * Math.sqrt(cell.invokes30d));
  return (
    <Tooltip content={label}>
      <button type="button" onClick={onClick} className="flex items-center justify-center rounded-interactive hover:bg-secondary/50 transition-colors" aria-label={label}>
        <svg width={BOX} height={BOX} viewBox={`0 0 ${BOX} ${BOX}`} aria-hidden className="block overflow-visible">
          {cell.tier === 'absent' && <circle cx={c} cy={c} r={1.5} className="fill-foreground/15" />}
          {cell.tier === 'cold' && (
            <circle cx={c} cy={c} r={6} fill="none" strokeWidth={1.25} className="stroke-foreground/35" strokeDasharray="2.5 2.5" />
          )}
          {cell.tier !== 'absent' && cell.tier !== 'cold' && (
            <circle
              cx={c} cy={c} r={r}
              style={{
                fill: accent ?? 'currentColor',
                fillOpacity: 0.35 + 0.6 * cell.heat,
                filter: `drop-shadow(0 0 ${Math.round(3 + 7 * cell.heat)}px ${accent ?? 'currentColor'})`,
              }}
            />
          )}
        </svg>
      </button>
    </Tooltip>
  );
}

export function TraceMatrixAurora({ model, onSelectSkill, onOpenInfo }: TraceOverviewProps) {
  const { t, tx } = useTranslation();
  const showGhost = model.loading && model.skills.length === 0;
  const topAccent = model.skills[0]?.visual?.color ?? null;

  if (showGhost) return <TraceGhosts columns={model.projects.length} />;

  return (
    <div className="relative flex flex-col min-h-0 h-full overflow-hidden rounded-card">
      {/* atmospheric wash from the hottest skill's accent */}
      {topAccent && (
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0"
          style={{ background: `radial-gradient(60% 45% at 22% 8%, ${topAccent}14, transparent 70%)` }}
        />
      )}
      <div className="relative overflow-auto flex-1 min-h-0 pr-2">
        <table className="border-separate border-spacing-y-2">
          <thead>
            <tr>
              <th className="text-left typo-caption text-foreground font-normal pr-3 pb-1">
                {tx(t.plugins.dev_tools.trace_skills_count, { count: model.skills.length })}
              </th>
              {model.projects.map((p) => (
                <th key={p.id} className="typo-caption text-foreground font-normal px-1 pb-1 max-w-[78px]">
                  <span className="block truncate" title={p.name}>{p.name}</span>
                </th>
              ))}
              <th aria-hidden className="w-full" />
            </tr>
          </thead>
          <tbody>
            {model.skills.map((s) => {
              const Icon = s.visual?.icon ?? Flame;
              const accent = s.visual?.color ?? null;
              return (
                <tr key={s.name} className="group">
                  <td className="pr-3">
                    <button
                      type="button"
                      onClick={() => onSelectSkill(s.name)}
                      className="relative flex items-center gap-2 min-w-52 w-full text-left rounded-interactive px-2 py-1.5 hover:bg-secondary/40 transition-colors overflow-hidden"
                    >
                      {/* accent gradient trail scaled by row heat */}
                      <span
                        aria-hidden
                        className="absolute inset-y-0 left-0 rounded-interactive"
                        style={{
                          width: `${Math.min(100, Math.round((s.totalHeat / Math.max(1, model.projects.length)) * 100))}%`,
                          background: accent ? `linear-gradient(90deg, ${accent}26, transparent)` : undefined,
                        }}
                      />
                      <Icon size={15} style={accent ? { color: accent } : undefined} className="relative shrink-0" />
                      <span className="relative typo-body truncate">{s.name}</span>
                      <span
                        className="relative typo-caption tabular-nums ml-auto shrink-0 px-1.5 rounded-interactive bg-secondary/70"
                        onClick={(e) => { e.stopPropagation(); onOpenInfo(s.name); }}
                      >
                        v{s.libraryVersion ?? '1.0'}
                      </span>
                    </button>
                  </td>
                  {model.projects.map((p) => (
                    <td key={p.id} className="text-center">
                      <AuroraCell
                        cell={model.cell(s.name, p.id)}
                        accent={accent}
                        label={p.name}
                        onClick={() => onSelectSkill(s.name)}
                      />
                    </td>
                  ))}
                  <td aria-hidden />
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
