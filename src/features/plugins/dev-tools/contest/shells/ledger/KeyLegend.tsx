// The console's key legend: every binding the current layer answers to, as
// key caps with their meaning. Extractable for any keyboard-first surface.
import { LEDGER_COPY as C } from './copy';

type KeyId = keyof typeof C.keyNames;

const LEDGER_KEYS: readonly KeyId[] = ['move', 'open', 'review', 'create', 'gains', 'back'];

export function KeyCap({ children }: { children: string }) {
  return (
    <kbd className="inline-flex min-w-6 items-center justify-center rounded-interactive border border-primary/20 bg-secondary/50 px-1.5 py-0.5 typo-code text-foreground">
      {children}
    </kbd>
  );
}

export function KeyLegend({ className = '' }: { className?: string }) {
  return (
    <dl
      aria-label={C.keysLabel}
      className={`flex flex-wrap gap-x-4 gap-y-1.5 rounded-card border border-primary/10 bg-secondary/15 px-3 py-2 ${className}`}
      data-testid="ledger-key-legend"
    >
      {LEDGER_KEYS.map((k) => (
        <div key={k} className="flex items-center gap-1.5">
          <dt>
            <KeyCap>{C.keyNames[k]}</KeyCap>
          </dt>
          <dd className="typo-caption text-foreground">{C.keyMeanings[k]}</dd>
        </div>
      ))}
    </dl>
  );
}
