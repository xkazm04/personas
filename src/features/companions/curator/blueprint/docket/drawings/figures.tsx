/**
 * The shared marks a decision's figure is built from.
 *
 * Every card draws the MEASURE it is about, in the same ink the ledger uses -
 * a mini spread of the nine channels, a before/after pair, a project's judged
 * share, a range on an axis. A decision whose figure is prose is a decision the
 * reader has to take on trust.
 */
import { Fragment } from 'react';

import { channelColour, CHANNELS } from '../../model/channels';
import { markOfReason } from '../../model/parseClause';
import type { ChannelMark } from '../../model/types';
import { fmt, times, widthPct } from '../../format';

/** Re-read a snapshot's raw sentences into marks, so the mini-ledger is real. */
function marksOf(reasons: string[]): Map<number, ChannelMark> {
  const out = new Map<number, ChannelMark>();
  for (const detail of reasons) {
    for (const spec of CHANNELS) {
      // The snapshot carries the scan's sentences, not its codes, so the
      // channel is recovered from the clause shape the projection documents.
      const hit =
        (spec.code === 'deviation' && detail.endsWith('consumer deviation(s)')) ||
        (spec.code === 'citation_gone' && detail.includes('citation(s) reported gone')) ||
        (spec.code === 'no_application' && detail.startsWith('no application')) ||
        (spec.code === 'expired_application' && detail.endsWith('expired application(s)')) ||
        (spec.code === 'thin_techniques' && detail.includes('design floor is')) ||
        (spec.code === 'never_swept' && detail.startsWith('never swept')) ||
        (spec.code === 'missing_use_when' && detail.includes('use_when')) ||
        (spec.code === 'single_stack' && detail.startsWith('single stack')) ||
        (spec.code === 'at_risk_application' && detail.includes('near their clock'));
      if (!hit) continue;
      const lead = /^(\d+)/.exec(detail);
      const count = lead ? Number(lead[1]) : 1;
      const mark = markOfReason({
        code: spec.code,
        weight: spec.multiplied ? spec.weight * count : spec.weight,
        detail,
      });
      if (mark) out.set(spec.id, mark);
      break;
    }
  }
  return out;
}

export function MiniLedger({ rows }: { rows: { label: string; reasons: string[]; points: number }[] }) {
  return (
    <div className="cb-minirow">
      <div className="cb-mh cb-mhead typo-label">{'·'}</div>
      {CHANNELS.map((spec) => (
        <div
          key={spec.id}
          className="cb-mh cb-gl"
          style={{ ['--cb-cc']: channelColour(spec.id) } as React.CSSProperties}
        >
          {spec.glyph}
        </div>
      ))}
      <div className="cb-mh typo-label">{'pts'}</div>
      {rows.map((row) => {
        const marks = marksOf(row.reasons);
        return (
          <MiniRow key={row.label} label={row.label} marks={marks} points={row.points} />
        );
      })}
    </div>
  );
}

function MiniRow({
  label,
  marks,
  points,
}: {
  label: string;
  marks: Map<number, ChannelMark>;
  points: number;
}) {
  return (
    <>
      <div className="cb-ml typo-caption">{label}</div>
      {CHANNELS.map((spec) => {
        const mark = marks.get(spec.id);
        return (
          <div
            key={spec.id}
            className="cb-cell"
            style={{ ['--cb-cc']: channelColour(spec.id) } as React.CSSProperties}
          >
            {mark ? (
              <span className="cb-pips">
                {times(Math.min(mark.count ?? 1, 6)).map((i) => (
                  <i key={i} />
                ))}
              </span>
            ) : (
              <span className="cb-flat" />
            )}
          </div>
        );
      })}
      <div className="cb-mt typo-data">{points}</div>
    </>
  );
}

export function PairRows({ rows }: { rows: { label: string; before: number; after: number }[] }) {
  return (
    <div className="cb-pairs typo-caption">
      {rows.map((r) => {
        const max = Math.max(r.before, r.after, 1);
        const delta = r.after - r.before;
        const tone = delta < 0 ? 'cb-dn' : delta > 0 ? 'cb-upv' : 'cb-eq';
        const sign = delta > 0 ? `+${String(delta)}` : delta < 0 ? `−${String(-delta)}` : '=';
        return (
          <Fragment key={r.label}>
            <span className="cb-dim">{r.label}</span>
            <span className="cb-pb">
              <i className="cb-b" style={{ width: widthPct(r.before, max) }} />
              <i className="cb-a" style={{ width: widthPct(r.after, max) }} />
            </span>
            <span className={`cb-pd ${tone}`}>{`${String(r.before)} → ${String(r.after)} ${sign}`}</span>
          </Fragment>
        );
      })}
    </div>
  );
}

export function CoverageBar({
  label,
  pairs,
  evaluated,
  staleVerdicts,
  scaleTo,
}: {
  label: string;
  pairs: number;
  evaluated: number;
  staleVerdicts: number;
  scaleTo: number;
}) {
  const part = (n: number) => widthPct((n / Math.max(1, pairs)) * 100 * (pairs / scaleTo), 100);
  return (
    <div className="cb-pj">
      <span className="cb-pn typo-caption cb-dim">{label}</span>
      <span className="cb-bar" style={{ height: '10px' }}>
        <i
          className="cb-ink-solid"
          style={
            {
              ['--cb-c']: 'var(--status-success)',
              width: part(evaluated - staleVerdicts),
              minWidth: '1px',
            } as React.CSSProperties
          }
        />
        <i
          className="cb-ink-stale"
          style={{ ['--cb-c']: 'var(--status-success)', width: part(staleVerdicts) } as React.CSSProperties}
        />
        <i className="cb-ink-unknown" style={{ width: part(pairs - evaluated) }} />
      </span>
      <span className="cb-pv typo-code">
        <b>{evaluated}</b>/{fmt(pairs)}
      </span>
    </div>
  );
}

export function RangeAxis({ lo, hi, max, loLabel, hiLabel }: { lo: number; hi: number; max: number; loLabel: string; hiLabel: string }) {
  return (
    <div className="cb-axis typo-code">
      <span className="cb-ln" />
      <span
        className="cb-rg"
        style={{ left: widthPct(lo, max), width: widthPct(hi - lo, max) }}
      />
      <span className="cb-tv" style={{ left: widthPct(lo, max) }}>
        {lo}
      </span>
      <span className="cb-tv" style={{ left: widthPct(hi, max) }}>
        {hi}
      </span>
      <span className="cb-tk" style={{ left: '0%' }}>
        0
      </span>
      <span className="cb-tk" style={{ left: widthPct(lo, max) }}>
        {loLabel}
      </span>
      <span className="cb-tk" style={{ left: widthPct(hi, max) }}>
        {hiLabel}
      </span>
    </div>
  );
}
