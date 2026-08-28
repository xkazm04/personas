/**
 * DeckAcceptedList — the rail's second tab: what the reviewer said YES to that
 * has not become work yet.
 *
 * Two properties it shares with `DeckQueueRail`'s decide list, on purpose, so
 * the tab switch never feels like a different app: rows are the same height
 * arithmetic (one constant, applied to BOTH the virtualizer and the row, so the
 * two cannot drift), and the list virtualizes above the same threshold.
 *
 * One property it deliberately does NOT share: these rows are DECIDABLE. The
 * decide list is a ledger — a row there moves the read head and nothing else,
 * because a second way to record a verdict is a second way for verdicts to
 * drift. Here the row IS the control: ticking it selects work to send, and the
 * only act reachable from this tab is the one the bar above performs.
 */
import { memo } from 'react';
import { Inbox } from 'lucide-react';

import { EmptyIllustration } from '@/features/shared/components/display/EmptyIllustration';
import { RelativeTime } from '@/features/shared/components/display/RelativeTime';
import { useVirtualList } from '@/hooks/utility/interaction/useVirtualList';
import { useTranslation } from '@/i18n/useTranslation';
import type { UndispatchedIdea } from '@/lib/bindings/UndispatchedIdea';

import type { AcceptedDispatch } from './useAcceptedDispatch';

/** Above this many rows the list virtualizes — same threshold as the decide
 *  list, so the two tabs behave identically at the same list length. */
const VIRTUALIZE_ABOVE = 40;

/**
 * Row height, fed to the virtualizer AND applied to the row.
 *
 * Taller than the decide list's 60 because this row carries a second, smaller
 * line the other does not: where the idea came from and how long it has been
 * sitting there. The age is the whole reason `dev_tools_undispatched_ideas`
 * returns `ageHours` — an accepted idea nobody sent is a decision going stale,
 * and a list that does not show that is just a list.
 *
 * 76 = `py-1.5` (6 + 6) plus two `typo-body` lines (14px x 1.65 x 2 = 46.2)
 * plus one `typo-label` meta line (~16) plus its `mt-0.5`.
 */
export const ACCEPTED_ROW_HEIGHT = 76;

const AcceptedRow = memo(function AcceptedRow({
  row,
  selected,
  onToggle,
}: {
  row: UndispatchedIdea;
  selected: boolean;
  onToggle: (id: string) => void;
}) {
  const { t, tx } = useTranslation();

  return (
    // A `<label>` and a real checkbox rather than a `<button role="checkbox">`:
    // the whole row is the hit target, the browser gives us the keyboard and
    // the checked semantics for free, and `aria-label` names WHICH row is being
    // ticked (the title alone is inside the label, but a screen reader reading
    // a 90-character title as the control's name is not usable).
    <label
      style={{ height: ACCEPTED_ROW_HEIGHT }}
      className={`flex w-full cursor-pointer items-start gap-2 overflow-hidden border-l-2 px-3 py-1.5 transition-colors ${
        selected
          ? 'border-primary bg-primary/10'
          : 'border-transparent hover:border-primary/30 hover:bg-secondary/40'
      }`}
    >
      <input
        type="checkbox"
        checked={selected}
        onChange={() => onToggle(row.id)}
        aria-label={tx(t.monitor.triage_accepted_row_aria, { title: row.title })}
        className="mt-1 h-3.5 w-3.5 shrink-0 cursor-pointer rounded border-primary/30 bg-secondary/30 accent-primary"
      />
      <span className="min-w-0 flex-1">
        <span data-accepted-name className="typo-body line-clamp-2 text-foreground">
          {row.title}
        </span>
        <span className="mt-0.5 flex items-center gap-1.5 typo-label text-muted-foreground">
          {/* The project is the one fact that makes a cross-project list
              readable at all — this rail reads every project's backlog, so
              without it two identically-titled ideas are indistinguishable. */}
          {row.projectName && <span className="truncate">{row.projectName}</span>}
          {row.projectName && <span aria-hidden>·</span>}
          <RelativeTime timestamp={row.acceptedAt} className="shrink-0 tabular-nums" />
        </span>
      </span>
    </label>
  );
});

export const DeckAcceptedList = memo(function DeckAcceptedList({ ctl }: { ctl: AcceptedDispatch }) {
  const { t } = useTranslation();
  const { rows, selected, toggle } = ctl;
  const virtualize = rows.length > VIRTUALIZE_ABOVE;
  const { parentRef, virtualizer } = useVirtualList(rows, ACCEPTED_ROW_HEIGHT);

  if (rows.length === 0) {
    // Only once the fetch has settled. A confident "nothing is waiting" over an
    // in-flight read is the same lie the deck's own cleared state used to tell
    // (see `UnifiedTriageQueue#backlog`) — while loading, the chrome above
    // stands alone and this space stays empty rather than asserting anything.
    if (ctl.loading) return <div className="min-h-0 flex-1" />;
    return (
      <div className="min-h-0 flex-1 overflow-y-auto px-3 py-8">
        <EmptyIllustration
          icon={Inbox}
          heading={t.monitor.triage_accepted_empty}
          description={t.monitor.triage_accepted_empty_sub}
        />
      </div>
    );
  }

  return (
    <div
      data-accepted-list
      ref={virtualize ? parentRef : undefined}
      className="min-h-0 flex-1 overflow-y-auto"
    >
      {virtualize ? (
        <ul className="relative w-full" style={{ height: virtualizer.getTotalSize() }}>
          {virtualizer.getVirtualItems().map((v) => {
            const row = rows[v.index]!;
            return (
              <li
                key={row.id}
                className="absolute inset-x-0 top-0"
                style={{ height: v.size, transform: `translateY(${v.start}px)` }}
              >
                <AcceptedRow row={row} selected={selected.has(row.id)} onToggle={toggle} />
              </li>
            );
          })}
        </ul>
      ) : (
        <ul>
          {rows.map((row) => (
            <li key={row.id}>
              <AcceptedRow row={row} selected={selected.has(row.id)} onToggle={toggle} />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
});
