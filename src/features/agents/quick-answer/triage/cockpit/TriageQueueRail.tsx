/**
 * TriageQueueRail — the left pane: the WHOLE queue, always visible.
 *
 * This is the Cockpit's thesis in one component. A swipe deck shows you one
 * card and asks you to trust that the stack behind it is sensible; the rail
 * shows you the stack. You can see that four reviews are waiting, that two of
 * them are urgent, that the practice you deferred is still down there, and you
 * can walk to any of them with the arrow keys WITHOUT deciding anything.
 *
 * Visual order is navigation order: the shell navigates the same flattened
 * group list this renders, so ↓ always lands on the row directly below.
 *
 * ⚠️ PROTOTYPE (/prototype round 1): English literals inline, `src/i18n/**` is
 * off-limits this round. See cockpitKinds.tsx for the full note.
 */
import { useEffect, useRef } from 'react';
import { Moon } from 'lucide-react';

import type { TriageCounts, TriageItem, TriageKind } from '../triageTypes';
import { KIND_META, KIND_ORDER, TONE_CHIP, WeightSignal } from './cockpitKinds';

export interface KindGroup {
  kind: TriageKind;
  items: TriageItem[];
}

/** Bucket the queue by kind, preserving the hook's weight/skip ordering inside
 *  each bucket. Exported so the shell can flatten it into navigation order. */
export function groupQueue(items: readonly TriageItem[]): KindGroup[] {
  return KIND_ORDER.map((kind) => ({ kind, items: items.filter((i) => i.kind === kind) })).filter(
    (g) => g.items.length > 0,
  );
}

function QueueRow({
  item,
  active,
  skipped,
  busy,
  onSelect,
}: {
  item: TriageItem;
  active: boolean;
  skipped: boolean;
  busy: boolean;
  onSelect: (id: string) => void;
}) {
  const ref = useRef<HTMLButtonElement>(null);
  const Icon = KIND_META[item.kind].icon;
  const tag = item.tags[0];

  // Keep the cursor visible when the keyboard walks the queue past the fold.
  useEffect(() => {
    if (active) ref.current?.scrollIntoView({ block: 'nearest' });
  }, [active]);

  return (
    <button
      ref={ref}
      type="button"
      role="option"
      aria-selected={active}
      aria-busy={busy || undefined}
      onClick={() => onSelect(item.id)}
      title={item.title}
      className={`w-full text-left flex items-start gap-2.5 pl-3 pr-2.5 py-2.5 border-l-[3px] transition-colors focus-ring ${
        active
          ? 'border-l-primary bg-primary/12 ring-1 ring-inset ring-primary/15'
          : 'border-l-transparent hover:bg-secondary/45'
      } ${skipped && !active ? 'opacity-60' : ''}`}
    >
      <Icon
        className={`w-3.5 h-3.5 mt-[3px] shrink-0 ${active ? 'text-primary' : 'text-foreground'}`}
        aria-hidden="true"
      />
      <span className="min-w-0 flex-1 flex flex-col gap-1.5">
        <span className="typo-title block truncate">{item.title}</span>
        <span className="flex items-center gap-1.5 min-w-0">
          {skipped && (
            <span className="inline-flex items-center gap-1 shrink-0 px-1 py-px rounded-interactive border border-primary/15 bg-secondary/40 typo-label text-foreground">
              <Moon className="w-2.5 h-2.5" aria-hidden="true" />
              Deferred
            </span>
          )}
          {tag && (
            <span
              className={`min-w-0 truncate px-1.5 py-px rounded-interactive border typo-label ${TONE_CHIP[tag.tone]}`}
            >
              {tag.label}
            </span>
          )}
        </span>
      </span>
      <WeightSignal weight={item.weight} className="mt-1 shrink-0" />
    </button>
  );
}

export function TriageQueueRail({
  groups,
  activeId,
  skippedIds,
  busyId,
  allCounts,
  activeKinds,
  onToggleKind,
  onSelect,
}: {
  groups: KindGroup[];
  activeId: string | null;
  skippedIds: ReadonlySet<string>;
  busyId: string | null;
  allCounts: TriageCounts;
  activeKinds: ReadonlySet<TriageKind>;
  onToggleKind: (kind: TriageKind) => void;
  onSelect: (id: string) => void;
}) {
  return (
    <aside className="w-[286px] shrink-0 flex flex-col border-r border-primary/12 bg-secondary/10">
      <div className="shrink-0 flex flex-col gap-2.5 px-3 py-3 border-b border-primary/10">
        <span className="typo-label text-muted-foreground">Filter the queue</span>
        <div className="flex flex-wrap gap-1.5">
          {KIND_ORDER.map((kind) => {
            const meta = KIND_META[kind];
            const Icon = meta.icon;
            const on = activeKinds.has(kind);
            const count = allCounts[kind];
            const verb = on ? 'Hide' : 'Show';
            return (
              <button
                key={kind}
                type="button"
                aria-pressed={on}
                aria-label={`${verb} ${meta.plural.toLowerCase()} (${count})`}
                title={`${verb} ${meta.plural.toLowerCase()}`}
                onClick={() => onToggleKind(kind)}
                className={`inline-flex items-center gap-1.5 px-2 py-1 rounded-pill border typo-label transition-colors focus-ring ${
                  on
                    ? TONE_CHIP.accent
                    : 'border-primary/12 bg-transparent text-foreground hover:bg-secondary/45'
                }`}
              >
                <Icon className="w-3 h-3" aria-hidden="true" />
                {meta.label}
                <span className="tabular-nums">{count}</span>
              </button>
            );
          })}
        </div>
      </div>

      <div
        className="flex-1 min-h-0 overflow-y-auto"
        role="listbox"
        aria-label="Triage queue"
        tabIndex={-1}
      >
        {groups.map((group) => (
          <section key={group.kind} role="group" aria-label={KIND_META[group.kind].plural}>
            <header className="sticky top-0 z-10 flex items-center gap-2 px-3 py-2 bg-background/95 border-b border-primary/10 backdrop-blur-sm">
              <span className="typo-label text-muted-foreground truncate">
                {KIND_META[group.kind].plural}
              </span>
              <span className="ml-auto shrink-0 typo-label text-foreground tabular-nums">
                {group.items.length}
              </span>
            </header>
            <div className="divide-y divide-primary/[0.06]">
              {group.items.map((item) => (
                <QueueRow
                  key={item.id}
                  item={item}
                  active={item.id === activeId}
                  skipped={skippedIds.has(item.id)}
                  busy={busyId === item.id}
                  onSelect={onSelect}
                />
              ))}
            </div>
          </section>
        ))}
      </div>
    </aside>
  );
}
