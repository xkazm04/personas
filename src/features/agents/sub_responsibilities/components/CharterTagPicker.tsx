import type { ReactNode } from 'react';
import { OptionChip } from '@/features/shared/components/forms/OptionChip';

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
      <span className="typo-label text-ink-1">{label}</span>
      <div
        role="radiogroup"
        aria-label={label}
        className={`flex flex-wrap gap-1.5 ${muted ? 'opacity-60' : ''}`}
      >
        {choices.map((c) => {
          const active = c.value === value;
          return (
            <OptionChip
              key={c.value}
              role="radio"
              selected={active}
              onSelect={() => onChange(c.value)}
              data-testid={`${testId}-${c.value}`}
            >
              <span className="typo-body">{c.label}</span>
              <span className="typo-caption text-ink-2 tabular-nums">{c.detail}</span>
            </OptionChip>
          );
        })}
      </div>
      {hint && <p className="typo-caption text-ink-2">{hint}</p>}
    </div>
  );
}
