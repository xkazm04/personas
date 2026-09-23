/**
 * One figure per kind of decision. The switch is exhaustive over
 * `DocketDrawing`, so a new kind arrives as a compile error rather than as a
 * card with nothing under its question.
 */
import type { DocketEntry } from '../../model/docket';
import { fmt } from '../../format';
import { useWords } from '../../words';

import { CoverageBar, MiniLedger, PairRows } from './figures';
import { ProposalDrawing } from './ProposalDrawings';

export function Drawing({ entry }: { entry: DocketEntry }) {
  const { w, tx } = useWords();
  const d = entry.drawing;
  if (!d) return null;

  switch (d.kind) {
    case 'subject_delta':
      return (
        <div className="cb-fig">
          <h4 className="typo-label cb-up">{w.fig_reason_moves}</h4>
          <MiniLedger
            rows={[
              { label: w.fig_before, reasons: d.before.reasons, points: d.before.points },
              { label: w.fig_after, reasons: d.after.reasons, points: d.after.points },
            ]}
          />
          <h4 className="typo-label cb-up">{w.fig_every_measure}</h4>
          <PairRows
            rows={[
              { label: w.side_techniques, before: d.before.techniques, after: d.after.techniques },
              { label: w.side_applications, before: d.before.applications, after: d.after.applications },
              { label: w.side_stacks, before: d.before.stacks, after: d.after.stacks },
              { label: w.verdict_points, before: d.before.points, after: d.after.points },
            ]}
          />
          <p className="typo-caption" style={{ marginTop: '7px' }}>
            {tx(w.fig_branch, { branch: d.branch })}
          </p>
        </div>
      );

    case 'coverage_delta': {
      const max = Math.max(d.before.pairs, d.after.pairs, 1);
      return (
        <div className="cb-fig">
          <h4 className="typo-label cb-up">
            {tx(w.fig_project_pairs, { project: d.project, pairs: fmt(d.before.pairs) })}
          </h4>
          <CoverageBar label={w.fig_before} {...d.before} scaleTo={max} />
          <CoverageBar label={w.fig_after} {...d.after} scaleTo={max} />
          <h4 className="typo-label cb-up">{w.fig_magnified}</h4>
          <CoverageBar label={w.fig_before} {...d.before} pairs={200} scaleTo={200} />
          <CoverageBar label={w.fig_after} {...d.after} pairs={200} scaleTo={200} />
          <PairRows
            rows={[
              { label: w.fig_judged, before: d.before.evaluated, after: d.after.evaluated },
              { label: w.verdict_stale, before: d.before.staleVerdicts, after: d.after.staleVerdicts },
            ]}
          />
        </div>
      );
    }

    case 'first_commit_consent':
      return (
        <div className="cb-fig cb-grant">
          <div className="typo-label cb-up" style={{ color: 'var(--brand-purple)' }}>
            {w.fig_a_grant}
          </div>
          <div className="cb-scope typo-caption">
            <div className="cb-sc cb-yes">
              <b className="cb-m typo-title-lg">{'✓'}</b>
              <span className="cb-lbl">
                {w.fig_write} <code className="typo-code">{d.paths.join(', ')}</code>
              </span>
            </div>
            <div className="cb-sc cb-no">
              <b className="cb-m typo-title-lg">{'✕'}</b>
              <span className="cb-lbl">{w.fig_push}</span>
            </div>
            <div className="cb-sc cb-no">
              <b className="cb-m typo-title-lg">{'✕'}</b>
              <span className="cb-lbl">{w.fig_merge}</span>
            </div>
          </div>
          <p className="typo-caption">{d.detail}</p>
        </div>
      );

    default:
      return <ProposalDrawing drawing={d} />;
  }
}
