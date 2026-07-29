/**
 * ShortcutChip / ShortcutLegend — the Cockpit's promise that it teaches its own
 * keyboard.
 *
 * The variant is keyboard-first, so no shortcut is allowed to be folklore: the
 * key that fires an action is printed ON the action, and the full map sits in a
 * legend strip along the foot of the surface. Chips are `aria-hidden` — the
 * control they annotate carries the key in its own `aria-label`, so a screen
 * reader hears "Accept, shortcut A" once rather than twice.
 *
 * ⚠️ PROTOTYPE (/prototype round 1): English literals inline, `src/i18n/**` is
 * off-limits this round. See cockpitKinds.tsx for the full note.
 */

export function ShortcutChip({
  keys,
  title,
  className = '',
}: {
  /** What is printed on the cap — "A", "↑", "1", "Esc". */
  keys: string;
  /** Optional hover explanation, e.g. "Accept this item". */
  title?: string;
  className?: string;
}) {
  return (
    <kbd
      aria-hidden="true"
      title={title}
      className={`inline-flex shrink-0 items-center justify-center min-w-[1.25rem] h-[1.125rem] px-1 rounded-interactive border border-primary/20 bg-background/70 typo-label text-foreground tabular-nums ${className}`}
    >
      {keys}
    </kbd>
  );
}

export interface LegendEntry {
  keys: string[];
  label: string;
}

/**
 * The full keyboard map, docked at the foot of the surface. Rendered once, at
 * one glance-able size — this is the difference between a surface that has
 * shortcuts and a surface that is operated by them.
 */
export function ShortcutLegend({ entries, className = '' }: { entries: LegendEntry[]; className?: string }) {
  return (
    <div className={`flex flex-wrap items-center gap-x-5 gap-y-1.5 ${className}`}>
      {entries.map((entry) => (
        <span key={entry.label} className="inline-flex items-center gap-1.5">
          <span className="inline-flex items-center gap-1">
            {entry.keys.map((k) => (
              <ShortcutChip key={k} keys={k} />
            ))}
          </span>
          <span className="typo-caption text-foreground">{entry.label}</span>
        </span>
      ))}
    </div>
  );
}
