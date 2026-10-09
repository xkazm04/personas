// The ledger's permanent furniture: the live line in the attention bar, the
// cold-load ghost, the window's own foot (how much is on screen and how to
// open the next page), and the season foot. Split out of `LedgerLevel.tsx`.
import { Clock, ListOrdered } from 'lucide-react';

import { Button } from '@/features/shared/components/buttons';
import { useTranslation } from '@/i18n/useTranslation';
import type { ContestSummary } from '@/lib/bindings/ContestSummary';

import { formatUntil } from '../model/contestModel';
import { seatWinRates } from '../stats';
import { nextStart, runningSeats, seasonSpend, seatElapsedS, shortTitle } from './ledgerModel';
import type { LedgerStrings } from './ledgerLabels';
import { LEDGER_PAGE_SIZE } from './ledgerPaging';
import type { LedgerPager } from './useLedgerWindow';
import { formatDuration, formatUsd, Rich, Seat, SeatText } from './parts';

export function LiveLine({ contests, nowMs, L }: { contests: ContestSummary[]; nowMs: number; L: LedgerStrings }) {
  const { tx, language } = useTranslation();
  const running = runningSeats(contests);
  if (!running.length) {
    const next = nextStart(contests, nowMs);
    if (next) {
      return (
        <>
          <Clock className="w-3.5 h-3.5 shrink-0" aria-hidden />
          <span className="min-w-0 truncate">
            <Rich template={L.live_next} values={{ title: <b>{shortTitle(next.summary.title)}</b>, when: formatUntil(next.ms, nowMs, language) }} />
          </span>
        </>
      );
    }
    return <span>{L.live_nothing}</span>;
  }
  const first = running[0]!;
  return (
    <>
      <i className="pulse" aria-hidden />
      <span className="min-w-0 truncate">
        <Rich
          template={L.live_building}
          values={{
            seat: (
              <b>
                <SeatText spec={first.seat.spec} />
              </b>
            ),
            elapsed: <b className="tab">{formatDuration(seatElapsedS(first.seat, nowMs))}</b>,
            title: shortTitle(first.summary.title),
          }}
        />
        {running.length > 1 && ` · ${tx(L.live_more, { count: running.length - 1 })}`}
      </span>
    </>
  );
}

/**
 * How much of the filtered set is on screen, and the door to the next page.
 * The sentinel above the bar is what the scroll observer watches, so reaching
 * the end loads the next 20 without a click; the button is the keyboard and
 * reduced-motion path to the same action.
 */
export function LedgerWindowFoot({ pager }: { pager: LedgerPager }) {
  const { t, tx } = useTranslation();
  if (!pager.hasMore) return null;
  const remaining = pager.total - pager.shown;
  return (
    <>
      <div ref={pager.sentinelRef} aria-hidden className="h-px" data-testid="ledger-sentinel" />
      <div className="lmore" data-testid="ledger-more">
        <span>{tx(t.pipeline.showing_count, { shown: pager.shown, total: pager.total })}</span>
        <Button variant="ghost" size="sm" className="cl-btn cl-sm" onClick={pager.loadMore} data-testid="ledger-load-more">
          {tx(t.agents.executions.load_more, { count: Math.min(LEDGER_PAGE_SIZE, remaining) })}
        </Button>
      </div>
    </>
  );
}

export function SeasonFoot({ contests, onStandings, L }: { contests: ContestSummary[]; onStandings: () => void; L: LedgerStrings }) {
  const { t, tx } = useTranslation();
  const s = t.plugins.contest;
  const board = seatWinRates(contests);
  const lead = board.rows[0];
  return (
    <div className="lfoot">
      <span>
        <Rich template={L.season_spend} values={{ amount: <b className="tab">{formatUsd(seasonSpend(contests))}</b> }} />
      </span>
      {lead && (
        <span className="inline-flex items-center gap-1.5">
          <Rich
            template={L.most_wins}
            values={{ seat: <Seat spec={lead.spec} quiet />, record: <b className="tab">{tx(L.record, { wins: lead.wins, entered: lead.entered })}</b> }}
          />
        </span>
      )}
      {lead && <span>{board.separated ? s.stats_separated : s.stats_not_separated}</span>}
      <Button variant="ghost" size="sm" className="cl-btn cl-sm" icon={<ListOrdered className="w-3.5 h-3.5" />} onClick={onStandings} data-testid="ledger-open-standings">
        {L.open_standings}
      </Button>
    </div>
  );
}

/** Cold load: rows' geometry under the column header, invisible for 120 ms. */
export function LedgerGhost() {
  return (
    <div aria-hidden data-testid="ledger-ghost">
      {Array.from({ length: 6 }).map((_, i) => (
        <div key={i} className="lghost animate-fade-in" style={{ animationDelay: `${120 + i * 35}ms` }}>
          <i />
          <i />
          <i />
          <i />
          <i />
          <i />
        </div>
      ))}
    </div>
  );
}
