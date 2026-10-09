// The open station widened into a water column: the instrument strip on the
// waterline, the four lane heads, the lane dividers, and one frame per reading
// placed at its own depth (four lanes x the same four bands as the chart).
import type { CSSProperties } from 'react';

import { laneScore, LANES } from '../soundingsModel';
import { Ladder, STATUS_COLOR, StatusMark, toolText } from '../soundingsParts';
import { useSoundingsModel } from '../context';
import { StationStrip } from './StationStrip';

export function StationColumn() {
  const { geo, nav, words, statusWord, liftedKey } = useSoundingsModel();
  const { m, tx, laneLabel } = words;
  const { level, curStation, readKey, marked, setReadKey, openCard, frameRefs } = nav;
  const { g, colSpan, column } = geo;
  if (level < 1 || !curStation || !g || !colSpan || !column) return null;
  const { island } = curStation;

  return (
    <div className="sd-col" key={island.slug} style={{ left: colSpan.l, width: colSpan.w }}>
      <StationStrip station={curStation} />
      <div className="sd-lanes" aria-hidden>
        {LANES.map((lane) => {
          const sc = laneScore(island, lane);
          return <span key={lane} className="typo-label">{laneLabel(lane)}<b>{`${sc.solid}/${sc.total}`}</b></span>;
        })}
      </div>
      {column.lanes.map((x) => <div key={x} className="sd-ldiv" style={{ left: x, top: g.wl + 6, height: g.bed - g.wl - 12 }} />)}
      {island.nodes.map((node) => {
        const f = column.frames[node.key];
        if (!f) return null;
        const second = node.detail ? toolText(node.detail) : node.status === 'unknown' ? m.soundings_could_not_read : '';
        const cls = [
          'sd-fr',
          f.one ? 'sd-one' : '',
          f.tight ? 'sd-tight' : '',
          readKey === node.key && level >= 1 ? 'sd-foc' : '',
          liftedKey === node.key ? 'sd-lifted' : '',
          marked.has(`${island.slug}:${node.key}`) ? 'sd-marked' : '',
        ].filter(Boolean).join(' ');
        return (
          <button
            key={node.key}
            ref={(el) => { if (el) frameRefs.current.set(node.key, el); else frameRefs.current.delete(node.key); }}
            type="button"
            className={cls}
            data-sd="frame"
            data-band={node.status === 'solid' ? 3 : undefined}
            data-testid={`sd-frame-${node.key}`}
            tabIndex={readKey === node.key ? 0 : -1}
            style={{ left: f.x, top: f.y, width: f.w, height: f.h, '--c': STATUS_COLOR[node.status] } as CSSProperties}
            aria-label={node.detail
              ? tx(m.soundings_frame_aria_detail, { dim: node.label, status: statusWord(node.status), detail: toolText(node.detail) })
              : tx(m.soundings_frame_aria, { dim: node.label, status: statusWord(node.status) })}
            onClick={(e) => { e.stopPropagation(); setReadKey(node.key); openCard(node.key); }}
          >
            <StatusMark status={node.status} />
            <span className="sd-fl">{node.label}</span>
            <Ladder node={node} />
            <span className={node.detail ? 'sd-ff' : 'sd-ff sd-none'}>{second}</span>
          </button>
        );
      })}
    </div>
  );
}
