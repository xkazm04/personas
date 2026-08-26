// Prototype variant B — "Gauges"
//
// Strategy: each project is a compact INSTRUMENT card. A four-segment health
// ring at the left (one arc per dimension, tinted by its tone — a full green
// ring means all four carry good signal) gives the project a single glanceable
// shape; the project name sits as a heading beside it with the debt count as
// a red numeral badge; below, the four dimensions are icon-led rows where
// ONLY the state word is coloured and the detail is quiet body text. The
// ring is the symbol; the words explain it.

import { useTranslation } from '@/i18n/useTranslation';
import type { TileView } from '../coverageModel';
import { TONE_TEXT, readDimensions, worstTone, type DimTone } from './coverageDimensions';

const ARC_STROKE: Record<DimTone, string> = {
  success: 'var(--status-success)',
  info: 'var(--status-info)',
  warning: 'var(--status-warning)',
  error: 'var(--status-error)',
  muted: 'color-mix(in oklab, var(--foreground) 25%, transparent)',
};

/** Four 90° arcs with small gaps — one per dimension, in DIM_KEYS order. */
function HealthRing({ tones, size = 56 }: { tones: DimTone[]; size?: number }) {
  const stroke = 6;
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const seg = c / 4;
  const gap = 4;
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="-rotate-90 shrink-0" aria-hidden="true">
      <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="currentColor" strokeWidth={stroke} className="text-primary/10" />
      {tones.map((tone, i) => (
        <circle key={i} cx={size / 2} cy={size / 2} r={r} fill="none" stroke={ARC_STROKE[tone]} strokeWidth={stroke}
          strokeDasharray={`${seg - gap} ${c - (seg - gap)}`} strokeDashoffset={-i * seg} strokeLinecap="butt" />
      ))}
    </svg>
  );
}

export function CoverageGauges({ tiles, onOpen }: { tiles: TileView[]; onOpen: (v: TileView) => void }) {
  const { t, tx } = useTranslation();
  const tc = t.overview.registry_coverage;
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
      {tiles.map((view) => {
        const dims = readDimensions(view, t, tx);
        const worst = worstTone(dims);
        const debts = view.tile.debts.length;
        return (
          <button key={view.tile.projectId} type="button" onClick={() => onOpen(view)}
            aria-label={tx(tc.tile_open_aria, { name: view.tile.projectName })}
            className="text-left rounded-card border border-primary/15 bg-secondary/20 p-3.5 flex flex-col gap-3 hover:border-primary/30 transition-colors focus-ring">
            <span className="flex items-center gap-3">
              <span className="relative">
                <HealthRing tones={dims.map((d) => d.tone)} />
                <span className={`absolute inset-0 flex items-center justify-center typo-caption font-semibold tabular-nums ${TONE_TEXT[worst]}`}>
                  {dims.filter((d) => d.tone === 'success' || d.tone === 'info').length}/4
                </span>
              </span>
              <span className="flex-1 min-w-0">
                <span className="typo-heading text-foreground block truncate">{view.tile.projectName}</span>
                <span className="flex items-center gap-2 mt-0.5">
                  {view.inSync ? (
                    <span className="typo-caption font-medium text-status-success">{tc.in_sync}</span>
                  ) : debts > 0 ? (
                    <span className="inline-flex items-center rounded-card bg-status-error/15 px-1.5 py-0.5 typo-caption font-semibold text-status-error tabular-nums">
                      {debts === 1 ? tc.debt_badge_one : tx(tc.debt_badge_other, { count: debts })}
                    </span>
                  ) : (
                    /* muted-ok: no-claim placeholder under the heading */
                    <span className="typo-caption text-foreground/50">{tc.state_no_signal}</span>
                  )}
                </span>
              </span>
            </span>
            <span className="flex flex-col gap-1.5 border-t border-primary/10 pt-2.5">
              {dims.map((d) => (
                <span key={d.key} className="flex items-center gap-2 min-w-0">
                  <d.icon className={`h-3.5 w-3.5 shrink-0 ${TONE_TEXT[d.tone]}`} aria-hidden="true" />
                  <span className="typo-caption text-foreground w-16 shrink-0">{d.label}</span>
                  <span className={`typo-caption font-semibold shrink-0 ${TONE_TEXT[d.tone]}`}>{d.state}</span>
                  {/* muted-ok: supporting detail behind the coloured state word */}
                  <span className="typo-caption text-foreground/55 truncate">{d.detail}</span>
                </span>
              ))}
            </span>
          </button>
        );
      })}
    </div>
  );
}
