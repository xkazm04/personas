/**
 * Identity plate: the bio as a bar against its readiness target, one dot per
 * language, the role as a filled or dashed block, and the four readiness slots
 * as cells (full / half / dashed).
 */
import type { ReadinessSlot, TwinBlueprintModel } from '../../../blueprintContract';
import { LANGUAGE_DOTS, share } from '../strataModel';
import { FaceSvg, Overflow, Unmeasured } from './FaceSvg';

const SLOTS: readonly ReadinessSlot[] = ['identity', 'tone', 'channels', 'memories'];
const BAR = { x: 8, y: 9, w: 78, h: 8 };

export function IdentityFace({ model, hatch }: { model: TwinBlueprintModel; hatch: string }) {
  const { bioChars, bioTarget, languages, role } = model.identity;
  const shown = languages.slice(0, LANGUAGE_DOTS);
  return (
    <FaceSvg hatch={hatch}>
      {bioChars === null ? (
        <Unmeasured hatch={hatch} {...BAR} />
      ) : (
        <g data-measured="true">
          <rect className="sf-track" x={BAR.x} y={BAR.y} width={BAR.w} height={BAR.h} />
          <rect className="sf-ink" x={BAR.x} y={BAR.y} width={BAR.w * share(bioChars, bioTarget)} height={BAR.h} />
          {bioChars > bioTarget && <Overflow x={BAR.x + BAR.w} y={BAR.y} h={BAR.h} />}
        </g>
      )}

      {shown.length === 0 ? (
        <circle className="sf-dash" cx={13} cy={30} r={4} data-measured="false" />
      ) : (
        shown.map((code, i) => <circle key={code} className="sf-ink" cx={13 + i * 11} cy={30} r={4} />)
      )}
      {languages.length > LANGUAGE_DOTS && <Overflow x={13 + LANGUAGE_DOTS * 11 - 5} y={26} h={8} />}

      <rect className={role ? 'sf-ink' : 'sf-dash'} x={80} y={25} width={12} height={10} />

      {SLOTS.map((slot, i) => {
        const status = model.readiness.slots[slot];
        const x = 8 + i * 21;
        return (
          <g key={slot} data-slot-status={status}>
            <rect className={status === 'empty' ? 'sf-dash' : 'sf-track'} x={x} y={44} width={18} height={9} />
            {status !== 'empty' && <rect className="sf-ink" x={x} y={44} width={status === 'set' ? 18 : 9} height={9} />}
          </g>
        );
      })}
    </FaceSvg>
  );
}
