// The verdict cell: one line of what the contest decided (or is still
// deciding), one line of how it got there. Split out of `LedgerLevel.tsx` —
// it is the one cell with a branch per phase and nothing else needs it.
import { AlertTriangle, Activity, Clock, FileText, Medal, Trophy, XCircle } from 'lucide-react';

import { useTranslation } from '@/i18n/useTranslation';
import { formatCount } from '@/lib/utils/formatters';

import { formatUntil } from '../model/contestModel';
import { phaseLabel, type ContestStrings } from '../model/labels';
import type { Verdict } from './ledgerModel';
import { stationLabel } from './ledgerLabels';
import { bucketColor, cssVars, Rich, Seat } from './parts';

export function VerdictCell({ verdict, s, nowMs }: { verdict: Verdict; s: ContestStrings; nowMs: number }) {
  const { tx, language } = useTranslation();
  const L = s.ledger;
  const v1 = (tone: string | null, icon: React.ReactNode, body: React.ReactNode) => (
    <div className="v1" style={tone ? cssVars({ '--t': tone }) : undefined}>
      {icon}
      <span className="min-w-0 truncate">{body}</span>
    </div>
  );
  switch (verdict.kind) {
    case 'decided':
      return (
        <>
          {v1('var(--status-success)', <Trophy className="ic w-3.5 h-3.5" aria-hidden />, (
            <>
              <span className="k">{verdict.key}</span> {verdict.name}
            </>
          ))}
          <div className="v2">{verdict.spec ? <Seat spec={verdict.spec} quiet /> : L.verdict_winner_recorded}</div>
        </>
      );
    case 'shortlisted':
      return (
        <>
          {v1('var(--status-info)', <Medal className="ic w-3.5 h-3.5" aria-hidden />, <Rich template={L.verdict_shortlist} values={{ keys: <span className="k">{verdict.keys.join(', ')}</span> }} />)}
          <div className="v2">
            {verdict.child ? tx(L.verdict_round, { n: verdict.child.round ?? 2, phase: phaseLabel(s, verdict.child.phase) }) : L.verdict_no_round}
          </div>
        </>
      );
    case 'review-empty':
      return (
        <>
          {v1('var(--status-warning)', <AlertTriangle className="ic w-3.5 h-3.5" aria-hidden />, L.verdict_no_variants)}
          <div className="v2">{L.verdict_nothing_to_sort}</div>
        </>
      );
    case 'review':
      return (
        <>
          <div className="v1">
            <span>
              <Rich template={L.verdict_sorted} values={{ sorted: <span className="k">{verdict.sorted}</span>, total: verdict.total }} />
            </span>
            <span className="segbar" aria-hidden>
              {verdict.buckets.map((b, i) => (
                <i key={i} style={b ? { background: bucketColor(b) } : undefined} />
              ))}
            </span>
          </div>
          <div className="v2">
            {verdict.lead
              ? tx(L.verdict_judges_lean, { key: verdict.lead.key, mean: formatCount(verdict.lead.mean, { precision: 1 }) })
              : verdict.ownWinner
                ? tx(L.verdict_winner_pending, { key: verdict.ownWinner })
                : L.verdict_no_winner}
          </div>
        </>
      );
    case 'failed':
      return (
        <>
          {v1('var(--status-error)', <XCircle className="ic w-3.5 h-3.5" aria-hidden />, verdict.station ? tx(L.verdict_stopped_at, { station: stationLabel(L, verdict.station) }) : L.verdict_stopped)}
          <div className="v2">
            {tx(L.verdict_delivered, { delivered: verdict.delivered, seats: verdict.seats })}
            {verdict.child && ` · ${tx(L.round_n, { n: verdict.child.round ?? 2 })}`}
          </div>
        </>
      );
    case 'queued':
      return (
        <>
          {v1('var(--status-info)', <Clock className="ic w-3.5 h-3.5" aria-hidden />, verdict.startMs ? tx(L.verdict_starts, { when: formatUntil(verdict.startMs, nowMs, language) }) : L.verdict_waiting)}
          <div className="v2">{verdict.startMs ? new Date(verdict.startMs).toLocaleString(language, { weekday: 'short', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : L.verdict_waiting}</div>
        </>
      );
    case 'live': {
      const template =
        verdict.phase === 'collecting' ? L.verdict_collecting : verdict.phase === 'judging' ? L.verdict_judging : verdict.phase === 'queued' ? L.verdict_queued : L.verdict_building;
      return (
        <>
          {v1('var(--status-processing)', <Activity className="ic w-3.5 h-3.5" aria-hidden />, (
            <Rich template={template} values={{ delivered: <span className="k">{verdict.delivered}</span>, expected: verdict.expected }} />
          ))}
          <div className="v2">
            {tx(L.verdict_live_seats, { count: verdict.building })}
            {verdict.waiting > 0 && ` · ${tx(L.verdict_live_waiting, { count: verdict.waiting })}`}
          </div>
        </>
      );
    }
    case 'draft':
      return (
        <>
          {v1(null, <FileText className="ic w-3.5 h-3.5" aria-hidden />, L.verdict_draft)}
          <div className="v2">{L.verdict_draft_hint}</div>
        </>
      );
  }
}
