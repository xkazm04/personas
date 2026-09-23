/**
 * The four figures for a decision that PROPOSES rather than reports: a forge
 * wave's cost as a range, a re-judge queue's backlog as rungs, phantom points
 * as hatched blocks, and a direction as the binary it actually is.
 *
 * Split from `Drawing.tsx` only so neither file grows past the repo's
 * component-size line; the switch there stays exhaustive over the union.
 */
import type { DocketDrawing } from '../../model/docket';
import { fmt, times } from '../../format';
import { useWords } from '../../words';

import { RangeAxis } from './figures';

export function ProposalDrawing({ drawing }: { drawing: DocketDrawing }) {
  const { w, tx } = useWords();
  const d = drawing;
  switch (d.kind) {
    case 'subject_proposal':
      return (
        <div className="cb-fig">
          <p className="typo-caption">
            <b style={{ color: 'var(--foreground)' }}>{w.fig_measured_gap}</b> {d.measuredGap}
          </p>
          <h4 className="typo-label cb-up">{w.fig_forge_cost}</h4>
          <RangeAxis lo={d.lo} hi={d.hi} max={Math.ceil(d.hi * 1.3)} loLabel={String(d.lo)} hiLabel={String(d.hi)} />
          <div className="cb-chain typo-caption">
            <span className="cb-dim">{w.fig_workers}</span>
            {times(d.workers).map((i) => (
              <i key={i} />
            ))}
            <span>
              <code className="typo-code">{d.artifact}</code>
            </span>
          </div>
          <p className="typo-caption cb-dim">{tx(w.fig_raised_by, { who: d.raisedBy })}</p>
        </div>
      );

    case 'stale_verdicts':
      return (
        <div className="cb-fig">
          <div className="typo-data-lg">
            {d.stale}{' '}
            <span className="typo-caption cb-dim">
              {tx(w.fig_of_verdicts_stale, { of: fmt(d.ofEvaluated) })}
            </span>
          </div>
          {d.sample.map((s) => (
            <div className="cb-lad" key={`${s.context}/${s.subject}`}>
              <span className="typo-caption">
                <code className="typo-code">{s.context}</code> {'→'}{' '}
                <b style={{ color: 'var(--foreground)' }}>{s.subject}</b>{' '}
                <span className="cb-dim">{s.judged}</span>
              </span>
              <span className="cb-rungs">
                {times(s.revisionsBehind).map((i) => (
                  <i key={i} style={{ height: `${String(6 + i * 3)}px` }} />
                ))}
                <span className="typo-code cb-dim" style={{ marginLeft: '5px' }}>
                  {tx(w.fig_behind, { n: s.revisionsBehind })}
                </span>
              </span>
            </div>
          ))}
        </div>
      );

    case 'decline_ratified':
      return (
        <div className="cb-fig">
          <div className="cb-phantom">
            {times(d.notes).map((i) => (
              <span className="cb-blk" key={i}>
                {times(d.each).map((j) => (
                  <i key={j} />
                ))}
              </span>
            ))}
          </div>
          <div className="typo-data-lg" style={{ color: 'var(--cb-ch5)' }}>
            {d.notes * d.each}{' '}
            <span className="typo-caption cb-dim">
              {tx(w.fig_phantom_points, { notes: d.notes, each: d.each })}
            </span>
          </div>
          <p className="typo-caption" style={{ marginTop: '6px' }}>
            {d.detail}
          </p>
        </div>
      );

    case 'coverage_gap':
      return (
        <div className="cb-fig">
          <div className="cb-gapd">
            <div className="cb-bx">
              <span className="typo-label cb-up cb-dim">{w.fig_the_gap}</span>
              <b className="typo-title-lg">{d.gap}</b>
            </div>
            <div className="cb-ar">{'→'}</div>
            <div className="cb-bx cb-solid">
              <span className="typo-label cb-up cb-dim">{w.fig_nearest_stand_in}</span>
              <b className="typo-title-lg">{d.nearestStandIn}</b>
            </div>
          </div>
          <p className="typo-caption">{d.note}</p>
        </div>
      );

    case 'direction_proposal':
      return (
        <div className="cb-fig">
          <div className="cb-chain typo-caption">
            <span className="cb-chip typo-label">{d.technique}</span>
            {'→'}
            <span className="cb-chip typo-label">{d.subject}</span>
            {'→'}
            <span className="cb-chip typo-label">{d.project}</span>
            <span className="cb-dim">{tx(w.fig_raised_by, { who: d.raisedBy })}</span>
          </div>
          <div className="cb-binary typo-caption">
            <div className="cb-acc">
              <b className="typo-title-lg">{w.fig_accept}</b>
              {w.fig_accept_say}
            </div>
            <div className="cb-dec">
              <b className="typo-title-lg">{w.fig_decline}</b>
              {w.fig_decline_say}
            </div>
          </div>
          <p className="typo-caption">{w.fig_no_third_state}</p>
        </div>
      );
    default:
      return null;
  }
}
