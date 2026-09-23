/**
 * Where the corpus stands: three blocks, and the middle one is the finding.
 *
 * The operator's whole reason for this page is that one of these numbers is
 * SMALL - the share of context-subject pairs anyone has ever judged. It is the
 * only figure on the page at hero scale, and the bar under it keeps the three
 * states of a verdict apart: still true, judged against a subject that has
 * since moved, and never looked at.
 */
import type { BlueprintModel } from '../model/types';
import { fmt, share, widthPct } from '../format';
import { useWords } from '../words';

function CorpusBlock({ model }: { model: BlueprintModel }) {
  const { w, tx } = useWords();
  return (
    <div className="cb-vb">
      <div className="cb-vtop">
        <span className="typo-data-lg">{fmt(model.subjects)}</span>
        <span className="cb-lab typo-caption" data-role="cb-verdict-label">
          <b>{w.verdict_subjects}</b> {tx(w.verdict_in_bundles, { n: model.domains })}
        </span>
      </div>
      <div className="cb-bar">
        <i
          className="cb-ink-solid"
          style={
            {
              ['--cb-c']: 'var(--cb-ch7)',
              width: widthPct(model.rows.length, model.subjects),
            } as React.CSSProperties
          }
        />
        <i className="cb-ink-unknown" style={{ flex: 1 }} />
      </div>
      <div className="cb-vfoot typo-caption">
        <span>
          <b>{fmt(model.rows.length)}</b> {w.verdict_want_work}
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

function JudgedBlock({ model }: { model: BlueprintModel }) {
  const { w, tx } = useWords();
  const c = model.consumers;
  const stillTrue = c.evaluated - c.staleVerdicts;
  const never = c.pairs - c.evaluated;
  return (
    <div className="cb-vb">
      <div className="cb-vtop">
        <span className="typo-hero" data-role="cb-verdict-figure">
          {share(c.evaluated, c.pairs) ?? w.not_measured}
        </span>
        <span className="cb-lab typo-body">
          {tx(w.verdict_pairs, { n: fmt(c.pairs) })}
        </span>
      </div>
      <div
        className="cb-bar cb-tall"
        data-cb-tip={tx(w.verdict_pairs_tip, {
          still: fmt(stillTrue),
          stale: fmt(c.staleVerdicts),
          never: fmt(never),
        })}
      >
        <i
          className="cb-ink-solid"
          style={
            {
              ['--cb-c']: 'var(--status-success)',
              width: widthPct(stillTrue, c.pairs),
              minWidth: '2px',
            } as React.CSSProperties
          }
        />
        <i
          className="cb-ink-stale"
          style={
            {
              ['--cb-c']: 'var(--status-success)',
              width: widthPct(c.staleVerdicts, c.pairs),
              minWidth: '2px',
            } as React.CSSProperties
          }
        />
        <i className="cb-ink-unknown" style={{ flex: 1 }} />
      </div>
      <div className="cb-vfoot typo-caption">
        <span style={{ color: 'var(--status-success)' }}>
          <b>{fmt(stillTrue)}</b> {w.verdict_still_true}
        </span>
        <span>
          <b>{fmt(c.staleVerdicts)}</b> {w.verdict_stale}
        </span>
        <span>
          <b>{fmt(never)}</b> {w.verdict_never_looked}
        </span>
      </div>
    </div>
  );
}

function ProjectsBlock({ model }: { model: BlueprintModel }) {
  const { w, tx } = useWords();
  const c = model.consumers;
  return (
    <div className="cb-vb">
      <div className="cb-vtop">
        <span className="typo-data-lg">{fmt(c.projects.length)}</span>
        <span className="cb-lab typo-caption">
          {w.verdict_projects}
          <br />
          {c.mapsStale ? (
            <b style={{ color: 'var(--status-warning)' }}>
              {tx(w.verdict_all_stale, { n: c.staleProjects })}
            </b>
          ) : (
            <b>{w.verdict_maps_fresh}</b>
          )}
        </span>
      </div>
      <div className="cb-candles">
        {c.projects.map((p) => {
          const filled = Math.max(2, Math.round(18 * (p.evaluated / Math.max(1, p.pairs)) * 9));
          return (
            <span
              key={p.slug}
              className="cb-cd"
              data-cb-tip={tx(w.project_tip, {
                slug: p.slug,
                evaluated: fmt(p.evaluated),
                pairs: fmt(p.pairs),
                pct: share(p.evaluated, p.pairs) ?? w.not_measured,
                stale: p.staleVerdicts,
                state: p.state,
              })}
            >
              <i className="cb-hollow" style={{ height: `${String(18 - Math.min(18, filled))}px` }} />
              <i className="cb-fill" style={{ height: `${String(Math.min(18, filled))}px` }} />
            </span>
          );
        })}
      </div>
      <div className="cb-vfoot typo-caption">
        <span>
          <b>{fmt(c.weak)}</b> {w.verdict_weak}
        </span>
        {c.problems.slice(0, 1).map((p) => (
          <span key={p} data-cb-tip={p}>
            {w.verdict_problems}
          </span>
        ))}
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
