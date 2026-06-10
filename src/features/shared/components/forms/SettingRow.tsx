import type { ReactNode } from 'react';
import { AccessibleToggle } from './AccessibleToggle';
import { ActivityDot } from '../display/ActivityDot';

interface SettingRowProps {
  /** Primary label — always full-opacity, leads the row. */
  label: string;
  /** Optional leading glyph (e.g. a lucide icon). */
  icon?: ReactNode;
  /** Secondary description, rendered muted below the label. */
  description?: ReactNode;
  /** Optional badge text below the description (e.g. a rolling-window count). */
  countLabel?: string | null;
  checked: boolean;
  disabled?: boolean;
  onChange: () => void;
  /**
   * `divider` (default) — bordered list row, icon-aligned to the top.
   * `card` — hover-highlighted rounded row, label/toggle vertically centered.
   */
  variant?: 'divider' | 'card';
  toggleSize?: 'sm' | 'md';
  /**
   * Optional leading status dot on the label line. `active` glows emerald
   * (e.g. a source enabled and currently capturing), `idle` is a muted dot
   * (enabled but quiet), `null`/omitted renders nothing.
   */
  statusDot?: 'active' | 'idle' | null;
  /** Optional test id on the row (the whole row is the toggle hit-target). */
  testId?: string;
}

/**
 * @catalog Label + description + toggle settings row with one consistent type ramp; shared across plugin setup panels.
 *
 * Centralizes the label/description/toggle pattern that plugin setup panels
 * were each hand-rolling, so the type hierarchy (full-opacity label, muted
 * description) stays consistent. The two `variant`s preserve the two existing
 * looks — Companion's bordered list and Brain's hover cards — behind one API.
 */
export function SettingRow({
  label,
  icon,
  description,
  countLabel,
  checked,
  disabled,
  onChange,
  variant = 'divider',
  toggleSize = 'md',
  statusDot,
  testId,
}: SettingRowProps) {
  const interactive = !disabled;
  const wrap =
    variant === 'card'
      ? 'flex items-center justify-between gap-4 px-3 py-2.5 rounded-modal hover:bg-secondary/20 transition-colors'
      : 'flex items-start gap-3 px-1 py-2 border-b border-foreground/5 last:border-b-0 transition-colors hover:bg-secondary/10';

  return (
    // The whole row is a mouse hit-target that toggles; the AccessibleToggle
    // below stays the single focusable/keyboard control (its own click stops
    // propagation so the switch doesn't double-fire onChange).
    <div
      className={`${wrap}${interactive ? ' cursor-pointer select-none' : ''}`}
      onClick={interactive ? onChange : undefined}
      data-testid={testId}
    >
      {icon ? <div className="mt-0.5 shrink-0">{icon}</div> : null}
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          {statusDot ? <ActivityDot tone={statusDot} size="xs" /> : null}
          <span className="typo-body font-medium">{label}</span>
        </div>
        {description ? (
          // Description: one step DOWN the type ramp from the label
          // (typo-body/medium → typo-caption/normal) and dimmed to /85 —
          // the deepest muting the no-low-contrast-text rule allows — so
          // the label/description pair reads as two distinct tiers instead
          // of two near-identical lines. leading-relaxed keeps multi-line
          // descriptions breathable at the smaller size.
          <div className="typo-caption font-normal text-foreground/85 leading-relaxed mt-1">
            {description}
          </div>
        ) : null}
        {countLabel ? (
          <div className="typo-caption text-foreground mt-1">{countLabel}</div>
        ) : null}
      </div>
      <div className="shrink-0" onClick={(e) => e.stopPropagation()}>
        <AccessibleToggle
          checked={checked}
          onChange={onChange}
          label={label}
          disabled={disabled}
          size={toggleSize}
        />
      </div>
    </div>
  );
}
