/**
 * DeckAcceptedList — the rail's second tab: what the reviewer said YES to that
 * has not become work yet.
 *
 * Two properties it shares with `DeckQueueRail`'s decide list, on purpose, so
 * the tab switch never feels like a different app: rows are the same height and
 * are grouped by project the same way (both from `deckRailGroups`, so neither
 * can drift), and both render into the same scroller (`DeckRailList`).
 *
 * One property it deliberately does NOT share: these rows are DECIDABLE. The
 * decide list is a ledger — a row there moves the read head and nothing else,
 * because a second way to record a verdict is a second way for verdicts to
 * drift. Here the row IS the control: ticking it selects work to send, and the
 * only act reachable from this tab is the one the bar above performs.
 *
 * WHAT THE 2026-08-29 SLIMMING DROPPED, so it is not rediscovered as a bug: the
 * row carried a second line with the project and the idea's AGE, and the age is
 * why `dev_tools_undispatched_ideas` returns `ageHours` at all — an accepted
 * idea nobody sent is a decision going stale. The project moved up into the
 * group header; the age was cut on the operator's call, halving the row and
 * leaving staleness unshown on this surface. `ageHours` still comes back over
 * IPC, so putting it back is a render change, not a data one.
 */
import { memo, useMemo } from 'react';
import { Inbox } from 'lucide-react';

import { EmptyIllustration } from '@/features/shared/components/display/EmptyIllustration';
import { useTranslation } from '@/i18n/useTranslation';
import type { UndispatchedIdea } from '@/lib/bindings/UndispatchedIdea';

import { DeckRailList } from './DeckRailList';
import { groupRailRows, RAIL_ROW_HEIGHT } from './deckRailGroups';

import type { AcceptedDispatch } from './useAcceptedDispatch';

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
      style={{ height: RAIL_ROW_HEIGHT }}
      className={`flex w-full cursor-pointer items-center gap-2 overflow-hidden border-l-2 border-b border-b-primary/8 px-3 transition-colors ${
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
        className="h-3.5 w-3.5 shrink-0 cursor-pointer rounded border-primary/30 bg-secondary/30 accent-primary"
      />
      {/* Same token and same single-line treatment as the decide row — see the
          note there about why `typo-body` is not tightened with a utility. */}
      <span data-accepted-name className="typo-body min-w-0 flex-1 truncate text-foreground">
        {row.title}
      </span>
    </label>
  );
});

export const DeckAcceptedList = memo(function DeckAcceptedList({ ctl }: { ctl: AcceptedDispatch }) {
  const { t } = useTranslation();
  const { rows, selected, toggle } = ctl;

  const flat = useMemo(
    () =>
      groupRailRows(
        rows,
        (row) => row.id,
        (row) => row.projectName,
        t.monitor.triage_rail_group_none,
      ),
    [rows, t],
  );

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
    <DeckRailList
      flat={flat}
      listAttr="data-accepted-list"
      renderRow={(row) => (
        <AcceptedRow row={row} selected={selected.has(row.id)} onToggle={toggle} />
      )}
    />
  );
});
