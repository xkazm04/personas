// DeckTopBar — the only chrome the deck allows itself.
//
// A momentum surface earns its speed by showing almost nothing: the variant
// switcher, what is in play, how far you have got, and the exit. No queue list,
// no detail rail, no secondary navigation — anything else is a place for the
// eye to go that isn't the card.
//
// The filter chips read `allCounts` (the tally BEFORE filtering), so a kind you
// have switched off still shows how much of it is waiting. A kind with nothing
// in it is rendered inert rather than hidden, because a chip that disappears
// makes the reviewer wonder what else vanished.
import { X } from 'lucide-react';

import Button from '@/features/shared/components/buttons/Button';

import { TRIAGE_KINDS, type TriageKind } from '../triageTypes';
import type { UnifiedTriageQueue } from '../useUnifiedTriage';
import { KIND_META, TONE_CHIP } from './DeckChips';

function KindFilterChip({
  kind,
  count,
  active,
  onToggle,
}: {
  kind: TriageKind;
  count: number;
  active: boolean;
  onToggle: () => void;
}) {
  const meta = KIND_META[kind];
  const Icon = meta.icon;
  const inert = count === 0;
  const label = `${meta.label} (${count})`;

  return (
    <button
      type="button"
      disabled={inert}
      onClick={onToggle}
      aria-pressed={active}
      aria-label={label}
      title={inert ? `No ${meta.label.toLowerCase()} waiting` : label}
      className={`focus-ring inline-flex items-center gap-1.5 rounded-pill border px-3 py-1 typo-caption transition-colors disabled:is-disabled ${
        active && !inert
          ? TONE_CHIP[meta.tone]
          : 'border-primary/12 bg-transparent text-foreground hover:bg-secondary/40'
      }`}
    >
      <Icon className="h-3.5 w-3.5 shrink-0" aria-hidden />
      <span>{meta.label}</span>
      <span className="typo-data tabular-nums">{count}</span>
    </button>
  );
}

export function DeckTopBar({
  queue,
  switcher,
  onClose,
}: {
  queue: UnifiedTriageQueue;
  switcher?: React.ReactNode;
  onClose: () => void;
}) {
  const total = queue.sessionTotal;
  const pct = total > 0 ? Math.min(100, (queue.decidedCount / total) * 100) : 0;

  return (
    <header className="flex h-14 shrink-0 items-center gap-3 border-b border-primary/10 bg-secondary/15 px-4">
      {switcher ? <div className="shrink-0">{switcher}</div> : null}
      {switcher ? <div className="h-6 w-px shrink-0 bg-primary/12" aria-hidden /> : null}

      <div className="flex min-w-0 items-center gap-1.5 overflow-x-auto">
        {TRIAGE_KINDS.map((kind) => (
          <KindFilterChip
            key={kind}
            kind={kind}
            count={queue.allCounts[kind]}
            active={queue.activeKinds.has(kind)}
            onToggle={() => queue.toggleKind(kind)}
          />
        ))}
      </div>

      <div className="ml-auto flex shrink-0 items-center gap-3">
        <div className="hidden items-center gap-2 sm:flex">
          <span className="typo-data tabular-nums text-foreground">
            {`${queue.decidedCount} / ${total}`}
          </span>
          <span
            className="block h-1.5 w-28 overflow-hidden rounded-pill bg-primary/12"
            role="progressbar"
            aria-label="Session progress"
            aria-valuenow={queue.decidedCount}
            aria-valuemin={0}
            aria-valuemax={total}
          >
            <span
              className="block h-full rounded-pill bg-primary transition-[width] duration-300 motion-reduce:transition-none"
              style={{ width: `${pct}%` }}
            />
          </span>
        </div>

        <Button
          variant="ghost"
          size="icon-sm"
          onClick={onClose}
          aria-label="Close triage"
          title="Close triage (Esc)"
          icon={<X className="h-4 w-4" />}
        />
      </div>
    </header>
  );
}
