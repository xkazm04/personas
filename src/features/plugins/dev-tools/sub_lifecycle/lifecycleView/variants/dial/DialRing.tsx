/**
 * The dial: the lifecycle drawn as the CYCLE it is named after. Each step owns an
 * equal arc of a crown read clockwise from 12 o'clock, and the arc's stroke is
 * that step's binding state, so the ring itself is a coverage gauge - how much
 * of the practice is armed is a shape, before it is a number.
 *
 * The hub states the denominator where the eye already is: `enforced / total`,
 * counting `live` only, because the product's own phrase for `detected` is "only
 * detected, not installed" and a gauge that counted it would overstate the repo.
 *
 * THE LADDER IS THE SHARED ONE IN A DIFFERENT MEDIUM. `journeyStyles` separates
 * the five states on stroke STYLE and WIDTH so they survive colour-blindness; a
 * CSS border cannot be an arc, so the same two axes are expressed as SVG
 * `stroke-width` and `stroke-dasharray` with the same meaning: a CLOSED stroke
 * means the binding exists, an OPEN one that it does not, and the heavy stroke is
 * a state you can act on. The node marks, the legend chips and the state chips in
 * the panel are still the shared ladder, so the key never lies about the figure.
 *
 * This is a FIGURE (doctrine 6c): a labelled list of the same states loses the
 * closure, and the closure is the bet. Its furniture - the plate, the heads, the
 * legend, the panel - is ordinary chrome and is not hand-rolled.
 */
import { Button } from '@/features/shared/components/buttons';

import { bindingStateLabel, stepGlyph, stepLabel } from '../../../journey/journeyLabels';
import { STATE_MARK, STATE_TEXT } from '../../../journey/journeyStyles';
import { useLifecycleViewModel } from '../../context';
import { useStepRoving } from '../../blocks/useStepRoving';
import { CENTRE, HUB_R, RING_R, SIZE, arcPath, dialSpokes, enforcedCount, polar } from './dial.model';
import type { DialSpoke } from './dial.model';

/** The ladder as an arc: width and dash, never colour alone. */
const ARC = {
  live: { cls: 'stroke-status-success', w: 9, dash: undefined },
  detected: { cls: 'stroke-status-info', w: 4, dash: undefined },
  pending: { cls: 'stroke-status-warning', w: 9, dash: '7 5' },
  missing: { cls: 'stroke-status-error', w: 9, dash: '2 4' },
  advisory: { cls: 'stroke-foreground/50', w: 4, dash: '7 5' },
} as const;

export function DialRing() {
  const { dl, tx, lanes, order, selected, select } = useLifecycleViewModel();
  const { activeIndex, bind, onKeyDown } = useStepRoving(order, selected?.id ?? null, select);
  const spokes = dialSpokes(order, lanes.before.length);
  const enforced = enforcedCount(order);
  const picked = spokes.find((s) => s.node.id === selected?.id);

  const renderSpoke = (spoke: DialSpoke, index: number) => {
    const { node } = spoke;
    const label = stepLabel(dl, node.id, node.label);
    const Glyph = stepGlyph(node.id);
    const on = node.id === selected?.id;
    return (
      <div key={node.id}>
        <Button
          ref={bind(index)}
          variant="ghost"
          size="icon-sm"
          tabIndex={index === activeIndex ? 0 : -1}
          aria-pressed={on}
          onClick={() => select(node.id)}
          aria-label={tx(dl.lc_node_label, { step: label, state: bindingStateLabel(dl, node.strongestState) })}
          data-testid={`lc-node-${node.id}`}
          data-state={node.strongestState}
          data-selected={on ? 'true' : undefined}
          className={`absolute -translate-x-1/2 -translate-y-1/2 bg-background ${STATE_MARK[node.strongestState]} ${
            on ? 'ring-2 ring-primary/60 ring-offset-2 ring-offset-background' : ''
          }`}
          style={{ left: `${spoke.x * 100}%`, top: `${spoke.y * 100}%` }}
          icon={<Glyph className={`w-3.5 h-3.5 ${STATE_TEXT[node.strongestState]}`} aria-hidden />}
        />
        <span
          aria-hidden
          className={`absolute -translate-x-1/2 -translate-y-1/2 w-16 text-center truncate typo-caption ${
            on ? 'font-semibold text-primary' : ''
          }`}
          style={{ left: `${spoke.labelX * 100}%`, top: `${spoke.labelY * 100}%` }}
        >
          {label}
        </span>
      </div>
    );
  };

  return (
    <div
      role="toolbar"
      aria-label={dl.lc_journey_label}
      onKeyDown={onKeyDown}
      className="relative w-[22rem] h-[22rem] shrink-0 mx-auto"
      data-testid="lc-journey-track"
    >
      <svg viewBox={`0 0 ${SIZE} ${SIZE}`} className="absolute inset-0 w-full h-full" aria-hidden>
        {picked && (
          <line
            x1={CENTRE} y1={CENTRE}
            x2={polar(RING_R - 16, picked.mid).x}
            y2={polar(RING_R - 16, picked.mid).y}
            className="stroke-primary/40" strokeWidth={2} strokeLinecap="round"
          />
        )}
        {spokes.map((s) => {
          const a = ARC[s.node.strongestState];
          return (
            <path
              key={s.node.id}
              d={arcPath(RING_R, s.from, s.to)}
              fill="none"
              strokeLinecap="butt"
              strokeWidth={a.w}
              strokeDasharray={a.dash}
              className={`${a.cls} ${s.node.id === selected?.id ? '' : 'opacity-80'}`}
            />
          );
        })}
      </svg>

      <div
        className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 flex flex-col items-center justify-center rounded-full border border-primary/15 bg-background"
        style={{ width: HUB_R * 2, height: HUB_R * 2 }}
        data-testid="lc-dial-hub"
      >
        <span className="typo-data-lg text-foreground tabular-nums">{enforced}/{order.length}</span>
        <span className="typo-eyebrow text-primary/80">{dl.lc_state_phrase_live}</span>
      </div>

      <div role="group" aria-label={dl.lc_lane_before} data-testid="lc-lane-before">
        {spokes.slice(0, lanes.before.length).map((s, i) => renderSpoke(s, i))}
      </div>
      <div role="group" aria-label={dl.lc_lane_after} data-testid="lc-lane-after">
        {spokes.slice(lanes.before.length).map((s, i) => renderSpoke(s, lanes.before.length + i))}
      </div>
    </div>
  );
}
