// A segmented radio row for the autonomy options popup (cadence, boldness).
// Arrow keys move the choice, as a radio group should; only the checked
// choice sits in the tab order.
import { useRef, type KeyboardEvent } from 'react';

export interface Choice<T extends string> {
  id: T;
  label: string;
  testId?: string;
}

export function ChoiceRow<T extends string>({
  label,
  choices,
  value,
  onChoose,
  disabled = false,
}: {
  label: string;
  choices: readonly Choice<T>[];
  value: T | null;
  onChoose: (id: T) => void;
  disabled?: boolean;
}) {
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  const current = Math.max(0, choices.findIndex((ch) => ch.id === value));

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const step = e.key === 'ArrowRight' || e.key === 'ArrowDown' ? 1 : e.key === 'ArrowLeft' || e.key === 'ArrowUp' ? -1 : 0;
    if (!step || disabled) return;
    e.preventDefault();
    const next = (current + step + choices.length) % choices.length;
    onChoose(choices[next]!.id);
    refs.current[next]?.focus();
  };

  return (
    <div
      role="radiogroup"
      aria-label={label}
      aria-disabled={disabled || undefined}
      onKeyDown={onKeyDown}
      className="grid auto-cols-fr grid-flow-col gap-1 rounded-interactive bg-secondary/40 p-1"
    >
      {choices.map((ch, i) => {
        const checked = ch.id === value;
        return (
          <button
            key={ch.id}
            ref={(el) => {
              refs.current[i] = el;
            }}
            type="button"
            role="radio"
            aria-checked={checked}
            tabIndex={i === current ? 0 : -1}
            disabled={disabled}
            onClick={() => onChoose(ch.id)}
            data-testid={ch.testId}
            className={`min-w-0 rounded-interactive px-2 py-1.5 typo-caption text-center transition-colors focus-ring disabled:is-disabled ${
              checked ? 'bg-primary/20 text-primary shadow-elevation-1' : 'text-foreground/80 hover:bg-secondary/70 hover:text-foreground'
            }`}
          >
            {ch.label}
          </button>
        );
      })}
    </div>
  );
}
