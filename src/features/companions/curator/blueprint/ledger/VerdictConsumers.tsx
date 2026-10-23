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

/** The candle track's height in px; `.cb-candles` declares the same number. */
const CANDLE_H = 18;

/** A stand-in count for the hidden sizer; only its width matters. */
const UNMEASURED_N = '00,000';
const FIGURE_STANDIN = '00.0%';

/**
 * The pairs label, sized for BOTH of its readings.
 *
 * The unmeasured and measured sentences differ in length, so at some widths one
 * wraps to two lines and the other to one. The verdict is an `auto` grid row,
 * so that difference moved the console, the ledger and the foot the moment the
 * plan landed (measured in the shot harness at 1400x900: CLS 0.378 across the
 * unmeasured -> measured transition). The other reading is laid in the same
 * grid cell, hidden, so the label always holds the taller of the two.
 */
function PairsLabel({ shown, other }: { shown: string; other: string }) {
  return (
    <span className="cb-lab cb-lab-stack typo-body">
      <span>{shown}</span>
      <span className="cb-lab-sizer" aria-hidden="true">{other}</span>
    </span>
  );
}

export function JudgedBlock({ model }: { model: BlueprintModel }) {
  const { w, tx } = useWords();
  const c = model.consumers;
  if (c.pairs === null || c.evaluated === null || c.staleVerdicts === null) {
    return (
      <div className="cb-vb">
        <div className="cb-vtop">
          <span className="typo-hero cb-lab-stack" data-role="cb-verdict-figure">
            <span>
              <Unmeasured size="hero" tip={w.verdict_pairs_unmeasured_tip} />
            </span>
            {/* Holds the width a measured share will take, so the label beside
                it wraps the same way before and after the plan lands. */}
            <span className="cb-lab-sizer" aria-hidden="true">{FIGURE_STANDIN}</span>
          </span>
          <PairsLabel shown={w.verdict_pairs_unmeasured} other={tx(w.verdict_pairs, { n: UNMEASURED_N })} />
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
        <PairsLabel shown={tx(w.verdict_pairs, { n: fmt(c.pairs) })} other={w.verdict_pairs_unmeasured} />
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
        {/* As tall as the candles that replace it, so the plan landing does not
            move the rows below. */}
        <div className="cb-bar" style={{ height: CANDLE_H }}>
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
          // The candle is the project's judged share, drawn to scale.
          //
          // It used to be `18 * share * 9` - a nine-fold amplification that
          // saturates at any share above 11%, so personas (10.1%),
          // personas-web (19.3%) and ai-registry (18.8%) all drew as a full
          // column and three different readings looked identical. On the one
          // page whose argument is that different facts must look different,
          // the only drawing that compared consumers was lying about all of
          // them. A 1px floor keeps a small share visible without claiming it
          // is a large one.
          const filled = Math.max(1, Math.round(CANDLE_H * (p.evaluated / Math.max(1, p.pairs))));
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
              <i className="cb-hollow" style={{ height: `${String(CANDLE_H - Math.min(CANDLE_H, filled))}px` }} />
              <i className="cb-fill" style={{ height: `${String(Math.min(CANDLE_H, filled))}px` }} />
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
