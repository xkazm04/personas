// L2: the plate that rises out of a frame and the card it becomes, plus the
// two transient overlays that belong to the same layer - Athena's sonar pings
// and the name tip over a sliver.
import { buoyDepth, stationSpan } from '../soundingsGeometry';
import { ProjectFile } from './ProjectFile';
import { ReadingCard } from './ReadingCard';
import { useSoundingsModel } from '../context';
import { FILE } from '../useSoundingsNav';

export function LiftedCard() {
  const { stations, rankOf, edges, relatedToCur, plateBox, geo, nav, handlers } = useSoundingsModel();
  const { lift, curStation, cardRef } = nav;
  const { g, card } = geo;

  return (
    <>
      {lift && plateBox && (
        <div className="sd-plate sd-on" data-phase={lift.phase} style={{ left: plateBox.x, top: plateBox.y, width: plateBox.w, height: plateBox.h }} aria-hidden />
      )}
      {lift && card && g && curStation && handlers && (
        <section
          ref={cardRef}
          className={lift.phase === 'open' ? 'sd-card sd-show' : 'sd-card'}
          style={{ left: card.x, top: card.y, width: card.w, height: card.h }}
          aria-labelledby="sd-card-title"
          tabIndex={-1}
          onClick={(e) => e.stopPropagation()}
        >
          {lift.key === FILE
            ? <ProjectFile station={curStation} stations={stations} rankOf={rankOf} edges={edges} related={relatedToCur} g={g} card={card} h={handlers} />
            : <ReadingCard station={curStation} dimKey={lift.key} stations={stations} g={g} card={card} h={handlers} />}
        </section>
      )}
    </>
  );
}

export function SonarPings() {
  const { nav } = useSoundingsModel();
  return (
    <div className="sd-pings" aria-hidden>
      {nav.pings.map((p) => <div key={p.id} className="sd-ping" style={{ left: p.x, top: p.y }}><i /><i /></div>)}
    </div>
  );
}

/** At L1/L2 a hovered sliver is too narrow for its name: show it beside. */
export function SliverTip() {
  const { stations, n, geo, nav } = useSoundingsModel();
  const { level, cur, hover } = nav;
  const { g } = geo;
  const s = hover !== null ? stations[hover] : undefined;
  if (!g || level < 1 || hover === null || hover === cur || !s) return null;
  const r = stationSpan(g, hover, level, cur ?? 0, n);
  const left = hover < (cur ?? 0) ? r.l + r.w + 8 : undefined;
  const right = hover > (cur ?? 0) ? g.W - r.l + 8 : undefined;
  return <div className="sd-tip" style={{ left, right, top: Math.max(4, buoyDepth(g, s.metrics.urgency) - 14) }}>{s.island.name}</div>;
}
