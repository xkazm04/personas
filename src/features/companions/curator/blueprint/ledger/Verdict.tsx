/**
 * Where the corpus stands: three blocks, and the middle one is the finding.
 *
 * The operator's whole reason for this page is that one of these numbers is
 * SMALL - the share of context-subject pairs anyone has ever judged. It is the
 * only figure on the page at hero scale, and the bar under it keeps the three
 * states of a verdict apart: still true, judged against a subject that has
 * since moved, and never looked at.
 *
 * BEFORE ANYTHING HAS BEEN MEASURED the strip still draws, with its labels and
 * its three blocks intact and the unknown mark where each figure will be. The
 * bars go to a single unknown ink rather than to zero width, because a bar
 * pinned at 0% is a claim that nothing is judged - which is precisely the
 * claim nobody is entitled to make before the instrument has run.
 */
import type { BlueprintModel } from '../model/types';
import { fmt, widthPct } from '../format';
import { useWords } from '../words';

import { Unmeasured } from './Unmeasured';
import { JudgedBlock, ProjectsBlock } from './VerdictConsumers';

function CorpusBlock({ model }: { model: BlueprintModel }) {
  const { w, tx } = useWords();
  if (model.subjects === null) {
    return (
      <div className="cb-vb">
        <div className="cb-vtop">
          <span className="typo-data-lg">
            <Unmeasured size="lg" />
          </span>
          <span className="cb-lab typo-caption" data-role="cb-verdict-label">
            <b>{w.verdict_subjects}</b> {w.verdict_bundles_unmeasured}
          </span>
        </div>
        <div className="cb-bar">
          <i className="cb-ink-unknown" style={{ flex: 1 }} />
        </div>
        <div className="cb-vfoot typo-caption">
          <span>
            <Unmeasured /> {w.verdict_want_work}
          </span>
          <span data-cb-tip={w.verdict_want_nothing_tip}>
            <Unmeasured /> {w.verdict_want_nothing}
          </span>
          <span>
            <Unmeasured /> {w.verdict_points}
          </span>
          <span>
            <Unmeasured /> {w.verdict_techniques}
          </span>
          <span>
            <Unmeasured /> {w.verdict_applications}
          </span>
        </div>
      </div>
    );
  }
  return (
    <div className="cb-vb">
      <div className="cb-vtop">
        <span className="typo-data-lg">{fmt(model.subjects)}</span>
        <span className="cb-lab typo-caption" data-role="cb-verdict-label">
          <b>{w.verdict_subjects}</b> {tx(w.verdict_in_bundles, { n: model.domains ?? w.not_measured })}
        </span>
      </div>
      <div className="cb-bar">
        <i
          className="cb-ink-solid"
          style={
            {
              ['--cb-c']: 'var(--cb-ch7)',
              width: widthPct(model.rows?.length ?? 0, model.subjects),
            } as React.CSSProperties
          }
        />
        <i className="cb-ink-unknown" style={{ flex: 1 }} />
      </div>
      <div className="cb-vfoot typo-caption">
        <span>
          <b>{fmt(model.rows?.length)}</b> {w.verdict_want_work}
        </span>
        <span data-cb-tip={w.verdict_want_nothing_tip}>
          <b>{fmt(model.quietSubjects)}</b> {w.verdict_want_nothing}
        </span>
        <span>
          <b>{fmt(model.planPoints)}</b> {w.verdict_points}
        </span>
        <span>
          <b>{fmt(model.techniques)}</b> {w.verdict_techniques}
        </span>
        <span>
          <b>{fmt(model.applications)}</b> {w.verdict_applications}
        </span>
      </div>
    </div>
  );
}

export function Verdict({ model }: { model: BlueprintModel }) {
  const { w } = useWords();
  return (
    <section className="cb-verdict" aria-label={w.verdict_region}>
      <CorpusBlock model={model} />
      <JudgedBlock model={model} />
      <ProjectsBlock model={model} />
    </section>
  );
}
