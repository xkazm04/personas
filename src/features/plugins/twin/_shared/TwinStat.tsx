/* ------------------------------------------------------------------ *
 *  TwinStat / TwinTile / TwinDivider
 *  Small primitives used across the redesigned Twin pages so that all
 *  hero KPI strips and tile rows share identical typography and spacing.
 * ------------------------------------------------------------------ */

export type TwinAccentSwatch = 'violet' | 'emerald' | 'amber' | 'cyan' | 'foreground' | 'rose' | 'indigo';

const TEXT_TONE: Record<TwinAccentSwatch, string> = {
  violet: 'text-violet-300',
  emerald: 'text-emerald-300',
  amber: 'text-amber-300',
  cyan: 'text-cyan-300',
  rose: 'text-rose-300',
  indigo: 'text-indigo-300',
  foreground: 'text-foreground',
};

const BORDER_TONE: Record<TwinAccentSwatch, string> = {
  violet: 'border-violet-500/25',
  emerald: 'border-emerald-500/25',
  amber: 'border-amber-500/25',
  cyan: 'border-cyan-500/25',
  rose: 'border-rose-500/25',
  indigo: 'border-indigo-500/25',
  foreground: 'border-primary/15',
};

interface TwinStatProps {
  label: string;
  value: number | string;
  accent?: TwinAccentSwatch;
}

/** Inline stat used inside the header band's KPI pill. */
export function TwinStat({ label, value, accent = 'violet' }: TwinStatProps) {
  return (
    <div className="flex flex-col items-start leading-tight">
      <span className={`typo-data-lg tabular-nums ${TEXT_TONE[accent]}`}>{value}</span>
      <span className="text-xs uppercase tracking-[0.18em] text-foreground/55">{label}</span>
    </div>
  );
}

/** Vertical 1-px separator between stats in the KPI pill. */
export function TwinStatDivider() {
  return <span className="w-px h-6 bg-primary/15" />;
}

interface TwinTileProps {
  label: string;
  value: number | string;
  accent?: TwinAccentSwatch;
}

/** Bordered KPI tile used in compact strip headers and footers. */
export function TwinTile({ label, value, accent = 'violet' }: TwinTileProps) {
  return (
    <div className={`rounded-interactive border ${BORDER_TONE[accent]} bg-card/40 px-2.5 py-1 flex flex-col items-center min-w-[68px]`}>
      <span className={`typo-data-lg tabular-nums leading-none ${TEXT_TONE[accent]}`}>{value}</span>
      <span className="text-xs uppercase tracking-[0.16em] text-foreground/55 mt-0.5">{label}</span>
    </div>
  );
}
