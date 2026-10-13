import type { ReactNode } from 'react';

export interface Choice<T extends string> {
  value: T;
  label: string;
  detail: string;
}

/**
 * One single-select tag picker. A radio group, not a tab strip: there is no
 * panel behind a choice, and the pill matches `ChipToggleList` — the
 * multi-select affordance the sibling editors use — so the card reads as the
 * same system with `aria-checked` in place of `aria-pressed`.
 *
 * Split out of `CharterResourceCard` unchanged (spark device-mesh WP3).
 */
export function TagPicker<T extends string>({
  label,
  hint,
  choices,
  value,
  muted,
  onChange,
  testId,
}: {
  label: string;
  hint?: ReactNode;
  choices: Choice<T>[];
  value: T;
  muted: boolean;
  onChange: (next: T) => void;
  testId: string;
}) {
  return (
    <div className="flex flex-col gap-1.5" data-testid={testId}>
      <span className="typo-label text-foreground">{label}</span>
      <div
        role="radiogroup"
        aria-label={label}
        className={`flex flex-wrap gap-1.5 ${muted ? 'opacity-60' : ''}`}
      >
        {choices.map((c) => {
          const active = c.value === value;
          return (
            <button
              key={c.value}
              type="button"
              role="radio"
              aria-checked={active}
              onClick={() => onChange(c.value)}
              className={`flex flex-col items-start px-2.5 py-1 rounded-interactive border text-left transition-colors focus-ring ${
                active
                  ? 'bg-primary/15 border-primary/40 text-primary'
                  : 'bg-secondary/30 border-primary/10 text-foreground/85 hover:border-primary/25'
              }`}
              data-testid={`${testId}-${c.value}`}
            >
              <span className="typo-body">{c.label}</span>
              <span className="typo-caption text-foreground tabular-nums">{c.detail}</span>
            </button>
          );
        })}
      </div>
      {hint && <p className="typo-caption text-foreground">{hint}</p>}
    </div>
  );
}
