/**
 * The two consumer-fed blocks of the verdict strip: what anyone has judged,
 * and which checkouts report at all.
 *
 * Split out of `Verdict.tsx` only for size. The rule they both obey is the
 * page's: a figure nobody has measured is drawn as the unknown mark, never as
 * `0` and never as `0.0%` - a share of nothing is not a small share.
 */
import type { BlueprintModel } from '../model/types';
import { fmt, share, widthPct } from '../format';
import { useWords } from '../words';

import { Unmeasured } from './Unmeasured';

export function JudgedBlock({ model }: { model: BlueprintModel }) {
  const { w, tx } = useWords();
  const c = model.consumers;
  if (c.pairs === null || c.evaluated === null || c.staleVerdicts === null) {
    return (
      <div className="cb-vb">
        <div className="cb-vtop">
          <span className="typo-hero" data-role="cb-verdict-figure">
            <Unmeasured size="hero" tip={w.verdict_pairs_unmeasured_tip} />
          </span>
          <span className="cb-lab typo-body">{w.verdict_pairs_unmeasured}</span>
        </div>
        <div className="cb-bar cb-tall" data-cb-tip={w.verdict_pairs_unmeasured_tip}>
          <i className="cb-ink-unknown" style={{ flex: 1 }} />
        </div>
        <div className="cb-vfoot typo-caption">
          <span>
            <Unmeasured /> {w.verdict_still_true}
          </span>
          <span>
            <Unmeasured /> {w.verdict_stale}
          </span>
          <span>
            <Unmeasured /> {w.verdict_never_looked}
          </span>
        </div>
      </div>
    );
  }
  const stillTrue = c.evaluated - c.staleVerdicts;
  const never = c.pairs - c.evaluated;
  return (
    <div className="cb-vb">
      <div className="cb-vtop">
        <span className="typo-hero" data-role="cb-verdict-figure">
          {share(c.evaluated, c.pairs) ?? w.not_measured}
        </span>
        <span className="cb-lab typo-body">{tx(w.verdict_pairs, { n: fmt(c.pairs) })}</span>
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

export function ProjectsBlock({ model }: { model: BlueprintModel }) {
  const { w, tx } = useWords();
  const c = model.consumers;
  if (c.projects === null) {
    return (
      <div className="cb-vb">
        <div className="cb-vtop">
          <span className="typo-data-lg">
            <Unmeasured size="lg" />
          </span>
          <span className="cb-lab typo-caption">
            {w.verdict_projects}
            <br />
            <b>{w.verdict_maps_unmeasured}</b>
          </span>
        </div>
        <div className="cb-bar">
          <i className="cb-ink-unknown" style={{ flex: 1 }} />
        </div>
        <div className="cb-vfoot typo-caption">
          <span>
            <Unmeasured /> {w.verdict_weak}
          </span>
        </div>
      </div>
    );
  }
  return (
    <div className="cb-vb">
      <div className="cb-vtop">
        <span className="typo-data-lg">{fmt(c.projects.length)}</span>
        <span className="cb-lab typo-caption">
          {w.verdict_projects}
          <br />
          {c.mapsStale ? (
            <b style={{ color: 'var(--status-warning)' }}>
              {tx(w.verdict_all_stale, { n: c.staleProjects ?? w.not_measured })}
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
