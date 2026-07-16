// The Focus-ink primitives the Passport Wall adopted from the Dev Tools
// cockpit prototype (R7–R9, docs/plans/dev-tools-cx-redesign.md): colour lives
// in TEXT and thin bars, never in cell backgrounds; healthy values RECEDE so
// deficiencies are the only things standing; an unwired/absent value is a blue
// INVITATION ("set up →"), not a grey gap. Owned by the Factory — the cockpit
// bench keeps its own copies until it is consolidated.
import { resolveTechIcon } from './techIcons';
import type { CellValue } from './passportRows';

export const INK = {
  teal: '#2DD4BF',
  amber: '#F59E0B',
  red: '#F87171',
  emerald: '#34D399',
  violet: '#8B5CF6',
  /** The SETUP hue: unconfigured ≠ sick ≠ fine — it's an invitation. */
  blue: '#60A5FA',
} as const;

/** Score (0–100) → ink. */
export function scoreInk(score: number): string {
  if (score >= 70) return INK.emerald;
  if (score >= 45) return INK.amber;
  return INK.red;
}

/** Ordinal position (0..1 in its scale) → ink. */
export function posInk(pos: number): string {
  if (pos >= 0.65) return INK.emerald;
  if (pos >= 0.35) return INK.amber;
  return INK.red;
}

/** How a cell reads in the Focus vocabulary — drives ink and the recede rule
 *  (good/info rows fade so deficiencies stand alone). */
export type InkKind = 'good' | 'warn' | 'bad' | 'setup' | 'info';

export function inkKindOf(v: CellValue): InkKind {
  switch (v.kind) {
    case 'level':
    case 'band':
      return v.score >= 70 ? 'good' : v.score >= 45 ? 'warn' : 'bad';
    case 'ordinal':
      return v.pos >= 0.65 ? 'good' : v.pos >= 0.35 ? 'warn' : 'bad';
    case 'present':
      return v.label ? 'good' : 'setup';
    case 'chips':
      return v.items.length ? 'info' : 'setup';
    case 'pips': {
      const on = v.items.filter((i) => i.on).length;
      return on === v.items.length ? 'good' : on === 0 ? 'bad' : 'warn';
    }
    case 'bool':
      return v.on ? 'good' : 'warn';
  }
}

export const INK_KIND_HEX: Record<InkKind, string> = {
  good: INK.emerald, warn: INK.amber, bad: INK.red, setup: INK.blue, info: 'rgba(148,163,184,.85)',
};

/** Segmented level bar — one segment per climbable step above the floor,
 *  filled to the level reached. 3-of-5 lit reads instantly, without reading. */
export function SegBar({ steps, reached, hue, faded }: {
  steps: number;
  reached: number;
  hue: string;
  faded?: boolean;
}) {
  return (
    <span className="flex gap-[3px]" role="img" aria-label={`level ${reached} of ${steps}`}>
      {Array.from({ length: steps }, (_, i) => (
        <span
          key={i}
          className="h-[4px] flex-1 rounded-full"
          style={
            i < reached
              ? { background: hue, boxShadow: faded ? undefined : `0 0 4px ${hue}55` }
              : { background: 'rgba(148,163,184,.14)' }
          }
        />
      ))}
    </span>
  );
}

/** Tech label → official brand glyph (techIcons resolver) with the name kept
 *  VISIBLE beside it — the icon aids recognition, the text keeps readability. */
export function TechInk({ label, muted }: { label: string; muted?: boolean }) {
  const match = resolveTechIcon(label);
  return (
    <span className="inline-flex items-center gap-1.5 min-w-0" title={label}>
      {match && (
        <svg width={15} height={15} viewBox="0 0 24 24" fill={match.icon.color ?? 'currentColor'} aria-hidden className="shrink-0">
          <path d={match.icon.path} />
        </svg>
      )}
      <span className={`typo-caption truncate ${muted ? 'text-foreground/70' : 'text-foreground/90'}`}>
        {match?.residual ? `${match.icon.title} · ${match.residual}` : label}
      </span>
    </span>
  );
}

/** Element-anchored tooltip/popover placement: below the anchor, left-aligned,
 *  flipping above and clamping horizontally when out of room. Render the
 *  positioned node through createPortal(document.body) — position:fixed
 *  resolves against transformed ancestors otherwise. */
export function anchorTip(rect: DOMRect, w: number, h: number): { left: number; top: number } {
  let left = rect.left;
  let top = rect.bottom + 8;
  if (left + w > window.innerWidth - 12) left = Math.max(12, window.innerWidth - w - 12);
  if (top + h > window.innerHeight - 12) top = Math.max(12, rect.top - h - 8);
  return { left, top };
}

/** Editorial tab row — quiet uppercase labels, active = teal underline. */
export function InkTabs<T extends string>({ tabs, active, onChange, label }: {
  tabs: Array<{ id: T; label: string }>;
  active: T;
  onChange: (id: T) => void;
  label: string;
}) {
  return (
    <div className="inline-flex items-center gap-3" role="tablist" aria-label={label}>
      <span className="text-[10px] uppercase tracking-[0.14em] text-foreground/35">{label}</span>
      {tabs.map((t) => {
        const on = t.id === active;
        return (
          <button
            key={t.id}
            type="button"
            role="tab"
            aria-selected={on}
            onClick={() => onChange(t.id)}
            className={`text-[10.5px] uppercase tracking-[0.1em] pb-0.5 border-b transition-colors focus-ring ${
              on ? 'text-foreground font-semibold' : 'text-foreground/45 hover:text-foreground/75 border-transparent'
            }`}
            style={on ? { borderColor: INK.teal } : undefined}
          >
            {t.label}
          </button>
        );
      })}
    </div>
  );
}
