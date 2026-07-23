// Shared leaf widgets for the passport matrix — the extractable, sibling-stable
// atoms both variants (Grid + Wall) compose. Keeping the seal / pips / gap mark
// identical across variants is deliberate: the cell LAYOUT diverges per variant
// metaphor, but a "readiness seal" should read the same wherever it appears.
import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Bot, ShieldCheck, Layers, Plug, Check, Minus, Info, type LucideIcon } from 'lucide-react';
import { Tooltip } from '@/features/shared/components/display/Tooltip';
import { scoreTint, AUTOMATION_LABEL, PROD_BAND_LABEL, type AutomationLevel, type ProdBand } from './passportModel';
import { anchorTip } from './passportInk';

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

const INFO_TIP_WIDTH = 252;

/**
 * A dimension-row label that opens a small click-popup explaining what the row
 * MEANS (click, not hover — the wall is dense and hover tips would fire
 * constantly while scanning columns). Portalled + element-anchored via
 * `anchorTip` so the matrix's overflow-x-auto never clips it.
 */
export function RowInfoLabel({ label, info }: { label: string; info: string }) {
  const [anchor, setAnchor] = useState<DOMRect | null>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!anchor) return;
    const close = () => setAnchor(null);
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') close(); };
    const onDown = (e: MouseEvent) => { if (panelRef.current && !panelRef.current.contains(e.target as Node)) close(); };
    window.addEventListener('keydown', onKey);
    const id = window.setTimeout(() => document.addEventListener('mousedown', onDown), 0);
    return () => { window.removeEventListener('keydown', onKey); window.clearTimeout(id); document.removeEventListener('mousedown', onDown); };
  }, [anchor]);

  const pos = anchor ? anchorTip(anchor, INFO_TIP_WIDTH, 96) : null;

  return (
    <>
      <button
        type="button"
        onClick={(e) => {
          // Read the rect NOW — e.currentTarget is detached by the time a
          // state-updater callback runs.
          const rect = e.currentTarget.getBoundingClientRect();
          setAnchor((a) => (a ? null : rect));
        }}
        aria-expanded={Boolean(anchor)}
        title={`What "${label}" means`}
        className="group/rl inline-flex items-center gap-1 text-left rounded-interactive -mx-1 px-1 py-0.5 hover:bg-primary/[0.05] transition-colors cursor-help focus-ring"
      >
        <span className="typo-caption text-foreground/65 group-hover/rl:text-foreground/90 transition-colors">{label}</span>
        <Info className="w-3 h-3 flex-shrink-0 text-primary/70 opacity-0 group-hover/rl:opacity-100 transition-opacity" aria-hidden />
      </button>
      {anchor && pos && createPortal(
        <div
          ref={panelRef}
          role="dialog"
          aria-label={`${label} — meaning`}
          style={{ top: pos.top, left: pos.left, width: INFO_TIP_WIDTH }}
          className="fixed z-[9996] rounded-modal border border-primary/15 bg-background shadow-elevation-4 px-3 py-2.5"
        >
          <span className="flex items-center gap-1.5 typo-caption font-semibold text-foreground mb-1">
            <Info className="w-3.5 h-3.5 text-primary/70 flex-shrink-0" aria-hidden />
            {label}
          </span>
          <p className="typo-caption text-foreground/65 leading-snug" style={{ fontWeight: 400 }}>{info}</p>
        </div>,
        document.body,
      )}
    </>
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
