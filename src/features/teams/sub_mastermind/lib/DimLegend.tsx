// Cell-state key (bottom-left). The canvas encodes its entire payload in six
// dimension-cell states, and nothing on screen said what they meant — a user
// who can't read the encoding is looking at decoration.
//
// Collapsed by default: the key is orientation, not a permanent panel, and the
// canvas has to stay the thing you look at. Each swatch reproduces the cell's
// real geometry (rx 8, mix(ink,16) fill, mix(ink,50) stroke, dashed for
// `absent`) rather than approximating with a dot, so the key matches what the
// map actually draws. Every row carries a text label — colour never carries
// the meaning alone.
import { useEffect, useRef, useState } from 'react';
import { KeyRound } from 'lucide-react';

import { useTranslation } from '@/i18n/useTranslation';
import type { Translations } from '@/i18n/generated/types';

import { DIM_INK, mix } from './ink';
import type { DimStatus } from './types';

const ORDER: DimStatus[] = ['solid', 'partial', 'risk', 'alert', 'unknown', 'absent'];

const statusLabel = (t: Translations, s: DimStatus) =>
  ({
    solid: t.mastermind.legend_solid,
    partial: t.mastermind.legend_partial,
    risk: t.mastermind.legend_risk,
    alert: t.mastermind.legend_alert,
    unknown: t.mastermind.legend_unknown,
    absent: t.mastermind.legend_absent,
  })[s];

/** One swatch, drawn the way the mosaic cell draws the real hex. */
function Swatch({ status }: { status: DimStatus }) {
  const absent = status === 'absent';
  const ink = DIM_INK[status];
  return (
    <svg width={18} height={14} viewBox="0 0 18 14" aria-hidden className="shrink-0">
      <rect
        x={0.75} y={0.75} width={16.5} height={12.5} rx={4}
        fill={absent ? mix('var(--secondary)', 40, 'var(--background)') : mix(ink, 16, 'var(--background)')}
        stroke={absent ? mix('var(--muted-foreground)', 38) : mix(ink, 50)}
        strokeWidth={1.25}
        strokeDasharray={absent ? '3 3' : undefined}
        opacity={absent ? 0.6 : 1}
      />
    </svg>
  );
}

export function DimLegend() {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  // Esc closes, matching every other transient surface on this canvas.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);

  return (
    <div ref={ref} className="absolute bottom-3 left-3 z-10 flex flex-col items-start gap-1.5">
      {open && (
        <div
          className="inline-flex flex-col gap-1 p-2 rounded-interactive bg-secondary/70 border border-primary/12 shadow-elevation-2 backdrop-blur-sm"
          data-testid="mm-legend-panel"
        >
          {/* No heading inside the panel: the toggle that opened it already
              says "Cell states", and repeating it would be the same idea twice. */}
          {ORDER.map((s) => (
            <span key={s} className="inline-flex items-center gap-2 typo-caption text-foreground whitespace-nowrap">
              <Swatch status={s} />
              {statusLabel(t, s)}
            </span>
          ))}
          {/* The one state that needs more than a label: `unknown` is deliberately
              distinct from a healthy zero, and that distinction is the point. */}
          <span className="typo-caption text-foreground max-w-52 pt-1 mt-0.5 border-t border-primary/12">
            {t.mastermind.legend_unknown_note}
          </span>
        </div>
      )}
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-label={t.mastermind.legend_toggle}
        data-testid="mm-legend-toggle"
        className={`inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-interactive typo-caption font-medium bg-secondary/70 border border-primary/12 shadow-elevation-2 backdrop-blur-sm transition-colors focus-ring ${
          open ? 'text-foreground' : 'text-foreground/70 hover:text-foreground'
        }`}
      >
        <KeyRound className="w-3.5 h-3.5" aria-hidden />
        {t.mastermind.legend_title}
      </button>
    </div>
  );
}
