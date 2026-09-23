// The survey line: a deed's parcels joined from its primary, nearest
// neighbour to nearest neighbour, with a halo under it and the deed's rank and
// name as a caption beside the primary. The line draws itself once (a
// dash-offset animation the stylesheet stills under reduced motion).
import type { Layout, Measure } from './cadastreLayout';
import { fit, surveyOrder } from './cadastreLayout';

export interface SurveyLinesProps {
  contextIds: string[];
  primaryId: string | null;
  lay: Layout;
  /** Caption beside the primary: `<rank>  <name>`. Omitted on the miniature. */
  caption?: string;
  measure: Measure;
  /** A key that restarts the draw when the deed changes. */
  drawKey: string;
}

export function SurveyLines({ contextIds, primaryId, lay, caption, measure, drawKey }: SurveyLinesProps) {
  const order = surveyOrder(contextIds, primaryId, lay);
  const start = order[0];
  if (!start) return null;
  const d = `M${order.map((p) => `${p.cx.toFixed(1)} ${p.cy.toFixed(1)}`).join(' L')}`;

  let cap = null;
  if (caption) {
    const lw = Math.min(280, measure(caption, 650) + 20);
    let lx = start.x + start.s + 8;
    let ly = start.y - 4;
    if (lx + lw > lay.W - 6) lx = start.x - lw - 8;
    if (lx < 6) lx = 6;
    ly = Math.max(6, Math.min(ly, lay.H - 30));
    cap = (
      <g className="sv-cap" transform={`translate(${lx.toFixed(1)} ${ly.toFixed(1)})`}>
        <rect width={lw.toFixed(1)} height="26" rx="7" />
        <text x="10" y="17.5">{fit(caption, lw - 20, 650, measure)}</text>
      </g>
    );
  }

  return (
    <g data-role="cad-survey-group" data-testid="cad-survey" data-parcels={order.length}>
      <path className="sv-halo" d={d} />
      <path key={drawKey} className="sv-line" data-role="cad-survey" d={d} pathLength={1} />
      {order.map((p, i) =>
        i === 0 ? (
          <g key={p.id}>
            <circle className="sv-prim" cx={p.cx} cy={p.cy} r={Math.min(p.s / 2 + 4, 15)} />
            <circle className="sv-dot" cx={p.cx} cy={p.cy} r={4} />
          </g>
        ) : (
          <circle key={p.id} className="sv-dot" cx={p.cx} cy={p.cy} r={3} />
        ),
      )}
      {cap}
    </g>
  );
}
