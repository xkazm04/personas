// Shared leaf widgets for the passport matrix — the extractable, sibling-stable
// atoms both variants (Grid + Wall) compose. Keeping the seal / pips / gap mark
// identical across variants is deliberate: the cell LAYOUT diverges per variant
// metaphor, but a "readiness seal" should read the same wherever it appears.
import { Bot, ShieldCheck, Layers, Plug, Check, Minus, type LucideIcon } from 'lucide-react';
import { Tooltip } from '@/features/shared/components/display/Tooltip';
import { scoreTint, AUTOMATION_LABEL, PROD_BAND_LABEL, type AutomationLevel, type ProdBand } from './passportModel';

const SECTION_ICONS: Record<string, LucideIcon> = {
  bot: Bot, 'shield-check': ShieldCheck, layers: Layers, plug: Plug,
};
export function SectionIcon({ name, className }: { name: string; className?: string }) {
  const Icon = SECTION_ICONS[name] ?? Layers;
  return <Icon className={className} aria-hidden />;
}

/**
 * The hero element: an app's readiness as a stamped seal — abbreviation (L4 / BE)
 * + 0–100 score, tinted by the score. The full band name (Integrated / Beta) is a
 * tooltip so the seal stays compact and scannable. `seal` adds the embossed
 * double-ring passport-stamp treatment used in the Wall's column covers.
 */
export function ReadinessSeal({
  kind, level, band, score, size = 'md', seal = false,
}: {
  kind: 'level' | 'band';
  level?: AutomationLevel;
  band?: ProdBand;
  score: number;
  size?: 'sm' | 'md' | 'lg';
  seal?: boolean;
}) {
  const tint = scoreTint(score);
  const code = kind === 'level' ? level! : bandCode(band!);
  const name = kind === 'level' ? AUTOMATION_LABEL[level!] : PROD_BAND_LABEL[band!];
  const pad = size === 'lg' ? 'px-2.5 py-1.5' : 'px-2 py-1';
  const codeCls = size === 'lg' ? 'typo-title-lg' : 'typo-data';
  return (
    <Tooltip content={`${name} — ${score}/100`}>
      <span
        className={`inline-flex items-center gap-1.5 rounded-card border ${pad} ${tint.bg} ${seal ? 'ring-1 ' + tint.ring + ' shadow-elevation-1' : ''} cursor-default`}
        style={{ borderColor: `color-mix(in srgb, ${tint.hex} 40%, transparent)` }}
      >
        <span className={`${codeCls} font-bold tabular-nums leading-none ${tint.text}`}>{code}</span>
        <span className={`typo-data tabular-nums leading-none ${tint.text} opacity-75`}>{score}</span>
      </span>
    </Tooltip>
  );
}

function bandCode(band: ProdBand): string {
  // A short two-letter code so the seal reads like a stamp (PR, BE, HD…).
  return { prototype: 'PT', internal: 'IN', beta: 'BE', production: 'PR', hardened: 'HD' }[band];
}

/**
 * Headline readiness as a FILLED PROGRESS BAR — the column-cover treatment for
 * the two axes. The axis label sits ON TOP, with the level code + 0–100 score
 * right-aligned beside it; a lean full-width bar (filled to the score in its
 * tint) runs underneath. Reads as comparable progress lines across columns.
 */
export function ScoreBar({
  label, kind, level, band, score,
}: {
  label: string;
  kind: 'level' | 'band';
  level?: AutomationLevel;
  band?: ProdBand;
  score: number;
}) {
  const tint = scoreTint(score);
  const code = kind === 'level' ? level! : bandCode(band!);
  const name = kind === 'level' ? AUTOMATION_LABEL[level!] : PROD_BAND_LABEL[band!];
  return (
    <div className="w-full">
      <div className="flex items-baseline justify-between gap-2 mb-1">
        <span className="typo-label text-foreground/45">{label}</span>
        <Tooltip content={`${name} — ${score}/100`}>
          <span className="inline-flex items-baseline gap-1 cursor-default">
            <span className={`typo-caption font-bold tabular-nums leading-none ${tint.text}`}>{code}</span>
            <span className={`typo-caption tabular-nums leading-none ${tint.text} opacity-70`}>{score}</span>
          </span>
        </Tooltip>
      </div>
      <span className="block relative w-full h-1 rounded-full overflow-hidden" style={{ background: 'color-mix(in srgb, var(--foreground) 9%, transparent)' }}>
        <span
          className="absolute inset-y-0 left-0 rounded-full transition-[width] duration-500"
          style={{ width: `${Math.max(3, Math.min(100, score))}%`, background: tint.hex }}
        />
      </span>
    </div>
  );
}

/** On/off capability pips with tiny labels — self-verify, artifacts. */
export function Pips({ items, size = 7 }: { items: Array<{ label: string; on: boolean }>; size?: number }) {
  return (
    <span className="inline-flex flex-wrap items-center gap-x-2 gap-y-1">
      {items.map((it) => (
        <span key={it.label} className="inline-flex items-center gap-1">
          <span
            className="rounded-full flex-shrink-0 transition-colors"
            style={{
              width: size, height: size,
              background: it.on ? '#10b981' : 'color-mix(in srgb, var(--foreground) 14%, transparent)',
            }}
          />
          <span className={`typo-caption tabular-nums ${it.on ? 'text-foreground/80' : 'text-foreground/35'}`}>{it.label}</span>
        </span>
      ))}
    </span>
  );
}

/** A single yes/no capability — check or muted dash. */
export function BoolMark({ on, label }: { on: boolean; label?: string }) {
  return (
    <span className={`inline-flex items-center gap-1.5 typo-caption ${on ? 'text-emerald-300' : 'text-foreground/35'}`}>
      {on ? <Check className="w-3.5 h-3.5" aria-hidden /> : <Minus className="w-3.5 h-3.5" aria-hidden />}
      {label && <span>{label}</span>}
    </span>
  );
}

/**
 * The meaningful-gap marker. Per the passport spec, `null` (no error tracking,
 * no metrics) is a FIRST-CLASS answer, not missing data — so it stays visible
 * (a slate dot + label), never a blank cell. Quieter than a present value, but
 * still scannable: spotting "which apps have no error tracking?" is the point.
 */
export function GapMark({ label = 'Absent' }: { label?: string }) {
  return (
    <span className="inline-flex items-center gap-1.5 typo-caption text-slate-400/80">
      <span className="w-1.5 h-1.5 rounded-full bg-slate-500/40 flex-shrink-0" aria-hidden />
      {label}
    </span>
  );
}

/** A tiny inline trend line — normalises the series to its own min/max so even
 *  small readiness moves are visible. Renders nothing below two points. */
export function Sparkline({ values, width = 42, height = 12, color }: { values: number[]; width?: number; height?: number; color?: string }) {
  if (values.length < 2) return null;
  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = max - min || 1;
  const pts = values
    .map((v, i) => {
      const x = (i / (values.length - 1)) * width;
      const y = height - ((v - min) / range) * (height - 2) - 1;
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(' ');
  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} aria-hidden className="overflow-visible">
      <polyline points={pts} fill="none" stroke={color ?? 'currentColor'} strokeWidth={1.25} strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  );
}

/** A named token chip (language, framework, integration vendor). */
export function Chip({ label, tone = 'neutral' }: { label: string; tone?: 'neutral' | 'accent' }) {
  return (
    <span
      className={`inline-flex items-center rounded-input px-1.5 py-0.5 typo-caption whitespace-nowrap ${
        tone === 'accent'
          ? 'bg-primary/10 text-primary border border-primary/15'
          : 'bg-secondary/40 text-foreground border border-primary/8'
      }`}
    >
      {label}
    </span>
  );
}
