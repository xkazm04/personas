// A preset picker whose menu opens ABOVE its trigger: the dispatch dock sits at
// the bottom of the board, so a downward menu would land off-screen. Non-portal
// on purpose — anchored inside the dock, out of flow, like the suggestions.
// Extracted from QuickDispatchDock 2026-09-17 (file-size split, no behaviour change);
// restyled 2026-09-21 as one of the Launch Rail's instrument pills — trigger
// chrome only, the upward-menu behaviour is untouched.
import { Check, ChevronUp } from 'lucide-react';

import { Listbox } from '@/features/shared/components/forms/Listbox';

export function DockPresetSelect({
  presets,
  value,
  onChange,
  format,
  ariaLabel,
  testId,
}: {
  presets: ReadonlyArray<string | null>;
  value: string | null;
  onChange: (v: string | null) => void;
  format: (v: string | null) => string;
  ariaLabel: string;
  testId: string;
}) {
  return (
    <Listbox
      ariaLabel={ariaLabel}
      itemCount={presets.length}
      onSelectFocused={(i) => onChange(presets[i] ?? null)}
      menuClassName="animate-fade-slide-in absolute bottom-full left-0 z-40 mb-1 min-w-full overflow-hidden rounded-card border border-border bg-background py-1 shadow-elevation-3"
      renderTrigger={({ isOpen, toggle }) => (
        <button
          type="button"
          onClick={toggle}
          aria-haspopup="listbox"
          aria-expanded={isOpen}
          aria-label={ariaLabel}
          data-testid={testId}
          // The Launch Rail's instrument pill: a pill rather than a rounded
          // rectangle, so the preset reads as a setting on the console and not
          // as a second button next to the launch. Set = accent-tinted.
          className={`typo-code flex h-6 items-center gap-1.5 whitespace-nowrap rounded-pill border px-2.5 transition-colors ${
            value
              ? 'border-accent/45 bg-accent/10 text-accent'
              : `border-card-border bg-card-bg text-foreground opacity-80 hover:border-primary/45 hover:opacity-100 [[data-theme^='light']_&]:border-primary/35 [[data-theme^='light']_&]:bg-secondary/50`
          }`}
        >
          <span className="whitespace-nowrap">{format(value)}</span>
          <ChevronUp className={`h-3 w-3 opacity-70 transition-transform ${isOpen ? '' : 'rotate-180'}`} aria-hidden />
        </button>
      )}
    >
      {({ close, focusIndex }) =>
        presets.map((p, i) => {
          const selected = p === value;
          return (
            <button
              key={p ?? '__default'}
              type="button"
              role="option"
              aria-selected={selected}
              onClick={() => {
                onChange(p);
                close();
              }}
              className={`flex w-full items-center gap-2 whitespace-nowrap px-2.5 py-1 text-left font-mono text-xs text-foreground transition-colors hover:bg-secondary/60 ${
                focusIndex === i ? 'bg-secondary/60' : ''
              }`}
            >
              <span className="w-3 flex-shrink-0">
                {selected && <Check className="h-3 w-3 text-primary" aria-hidden />}
              </span>
              {format(p)}
            </button>
          );
        })
      }
    </Listbox>
  );
}
