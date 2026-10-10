// Every project a buoy at its urgency depth. The one region that exists at all
// three levels: at L1/L2 the stations that are not open shrink to slivers and
// keep their mark, so the portfolio never disappears behind one project.
import type { CSSProperties } from 'react';

import { buoyDepth, stationSpan } from '../soundingsGeometry';
import { stationReasons } from '../soundingsModel';
import { FlagGlyph, STATUS_COLOR, StatusMark, TideGlyph } from '../soundingsParts';
import { useSoundingsModel } from '../context';

export function StationBuoys() {
  const { stations, n, rank, geo, nav, words, relatedToCur } = useSoundingsModel();
  const { m, tx, bandName, reasonText } = words;
  const { level, cur, focus, hover, marked, setHover, setFocusSlug, goL1, buoyRefs } = nav;
  const { g, booted, labelSlots } = geo;
  if (!g) return null;

  return (
    <div className="sd-stations">
      {stations.map((s) => {
        const i = s.index;
        const r = stationSpan(g, i, level, cur ?? 0, n);
        const sm = s.metrics;
        const y = booted && !s.ghost ? buoyDepth(g, sm.urgency) : g.bed - 18;
        const cls = [
          'sd-st',
          hover === i ? 'sd-hov' : '',
          level === 0 && focus === i ? 'sd-foc' : '',
          level > 0 && i !== cur ? 'sd-sl' : '',
          level > 0 && i === cur ? 'sd-cur' : '',
          i === rank[0] && sm.urgency > 0 ? 'sd-top1' : '',
          sm.waiting ? 'sd-aw' : '',
          level > 0 && relatedToCur.has(i) ? 'sd-rel' : '',
          s.ghost ? 'sd-ghoststation' : '',
          labelSlots[i] === 'below' ? 'sd-lbl-below' : '',
          labelSlots[i] === 'hidden' ? 'sd-lbl-hidden' : '',
        ].filter(Boolean).join(' ');
        const rs = stationReasons(s);
        const aria = s.ghost
          ? tx(m.soundings_ghost_aria, { name: s.island.name })
          : rs.length
            ? tx(m.soundings_buoy_aria_why, { name: s.island.name, band: bandName[sm.band]!, reasons: rs.map(reasonText).join(', ') })
            : tx(m.soundings_buoy_aria, { name: s.island.name, band: bandName[sm.band]! });
        const style = { left: r.l, width: r.w, '--y': y, '--wl': g.wl, '--i': i, '--mc': STATUS_COLOR[sm.mark] } as CSSProperties;
        return (
          <div
            key={s.island.slug}
            className={cls}
            data-band={sm.band}
            data-mc={sm.mark}
            style={style}
            onMouseEnter={() => setHover(i)}
            onMouseLeave={() => setHover((h) => (h === i ? null : h))}
          >
            <div className="sd-pl" />
            <div className="sd-line" />
            <div className="sd-floats" aria-hidden>
              {sm.waiting && <span className="sd-fl-aw"><FlagGlyph /></span>}
              {sm.alerts > 0 && <span className="sd-fl-al">{sm.alerts}</span>}
              {sm.late && <span className="sd-fl-late"><TideGlyph />{m.world_late}</span>}
            </div>
            <div className="sd-tick" />
            <div className="sd-sldot" />
            <span className="sd-vtag">{s.island.name}</span>
            <button
              ref={(el) => { if (el) buoyRefs.current.set(s.island.slug, el); else buoyRefs.current.delete(s.island.slug); }}
              type="button"
              className="sd-buoy"
              data-sd="buoy"
              tabIndex={level === 0 && focus === i ? 0 : -1}
              aria-label={aria}
              data-testid={`sd-buoy-${s.island.slug}`}
              onClick={(e) => { e.stopPropagation(); if (level === 0) goL1(i); }}
              onFocus={() => { if (level === 0 && focus !== i) setFocusSlug(s.island.slug); }}
            >
              <span className="sd-nm typo-title-lg">{s.island.name}</span>
              <span className={marked.has(s.island.slug) ? 'sd-bm sd-marked' : 'sd-bm'}><StatusMark status={sm.mark} /></span>
            </button>
            <button
              type="button"
              className="sd-slbtn"
              tabIndex={-1}
              aria-label={s.island.name}
              onClick={(e) => { e.stopPropagation(); goL1(i); }}
            />
          </div>
        );
      })}
    </div>
  );
}
