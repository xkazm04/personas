import { memo } from 'react';
import { Keyboard } from 'lucide-react';

import { Button } from '@/features/shared/components/buttons';
import { Figure, Hint } from '@/features/shared/components/kit';
import { useTranslation } from '@/i18n/useTranslation';
import type { AwayRules } from '@/lib/bindings/AwayRules';
import { pos } from '../../model/timeAxis';
import type { StandupView } from '../../model/types';
import { Kbd } from '../../parts/Kbd';
import { pct } from '../../parts/svgUnits';
import { FOCUS_COPY as F } from './copy';

/** Today's host CPU (green where an agent ran) beside tonight's lanes (amber = idle lane time). */
function MachineDrawing({ view }: { view: StandupView }) {
  const m = view.machine;
  const laneH = 1 / m.lanes;
  const now = view.status === 'armed' ? pos(view.nowMs, view.night) : null;
  return (
    <div className="sf-machine__draw">
      <svg aria-hidden="true">
        {m.bars.map((b) => {
          const h = Math.max(0.06, b.cpu);
          return <rect key={b.pos} className={b.busy ? 'su-bar su-bar--busy' : 'su-bar'} x={pct(b.pos + b.width * 0.1)} y={pct(1 - h)} width={pct(b.width * 0.8)} height={pct(h)} />;
        })}
      </svg>
      <svg aria-hidden="true">
        {Array.from({ length: m.lanes }, (_, i) => (
          <rect key={`l${i}`} className="su-lane-bg" x="0" y={pct(i * laneH)} width="100%" height={pct(laneH * 0.82)} rx="2" />
        ))}
        {m.laneBlocks.map((b) => (
          <rect key={b.id} className={`su-blk su-blk--${b.tone}`} x={pct(b.start)} y={pct(b.lane * laneH)} width={pct(Math.max(0.004, b.end - b.start))} height={pct(laneH * 0.82)} rx="2" />
        ))}
        {now !== null && <line className="su-nowline" x1={pct(now)} x2={pct(now)} y1="0" y2="100%" />}
      </svg>
    </div>
  );
}

/**
 * The rail's foot: the machine as one small figure with one plain caption
 * (the full key in its hint), then the away rules and the key card.
 */
export const RailFoot = memo(function RailFoot({ view, rules, onRules, onKeys }: {
  view: StandupView;
  rules: AwayRules | null;
  onRules: () => void;
  onKeys: () => void;
}) {
  const { t, tx } = useTranslation();
  const m = view.machine;
  const hasPlan = m.laneBlocks.length > 0;
  const caption = hasPlan ? tx(F.machine_caption, { dead: Math.round(m.deadShare * 100) }) : F.machine_caption_empty;
  const hint = tx(F.machine_hint, { units: m.peakUnits, lanes: m.lanes });
  return (
    <div className="sf-foot">
      {view.life !== 'none' && (
        <div className="sf-machine">
          <Hint content={hint}>
            <div className="sf-machine__fig" tabIndex={0}>
              <Figure label={F.machine} desc={`${caption}. ${hint}`} height={32}>
                <MachineDrawing view={view} />
              </Figure>
            </div>
          </Hint>
          <div className="sf-machine__legend">
            <span className="typo-caption sf-clip">{F.machine_today}</span>
            <span className="typo-caption sf-clip">{caption}</span>
          </div>
        </div>
      )}
      <div className="sf-foot__tools">
        <Button variant="ghost" size="sm" onClick={onRules} icon={<Kbd>R</Kbd>}>{F.rules}</Button>
        {rules && <span className="typo-caption sf-clip">{tx(F.rules_caption, { n: rules.park.length })}</span>}
        <Button variant="ghost" size="icon-sm" onClick={onKeys} aria-label={t.athena.standup.footer.keys} icon={<Keyboard className="w-4 h-4" />} />
      </div>
    </div>
  );
});
