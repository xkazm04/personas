// One step on the step screen's mini-map: a key-sized pin holding the step's
// glyph and its verdict glyph, outlined in the verdict's stroke (solid, dashed
// for not measured, dotted for stale, a hairline for instructed) over its wash,
// so a verdict reads by shape and glyph, never by colour alone. The current
// step's pin is RAISED (depth and the selection ring) and LABELLED with the
// step's name; every other pin names itself in a tooltip and to a reader.
//
// The whole pin is the press target (the button's stretched hit area); only
// the current pin is a tab stop, since Left / Right already walk the steps.
import { Button } from '@/features/shared/components/buttons';
import { Tooltip } from '@/features/shared/components/display/Tooltip';

import { stepGlyph, stepLabel } from '../../../journey/journeyLabels';
import type { HealthStep } from '../../layer1/healthModel';
import { healthLabel } from '../../layer1/layer1Labels';
import { useLifecycleViewModel } from '../../context';
import { lcSurface } from '../../system/lcSurface';
import { LT } from '../../system/lcType';
import { PILL_STROKE, PILL_TONE, VERDICT_LOOK, pillFilled } from '../../system/pillLooks';
import { GLYPH } from '../../system/scales';

const STRETCH = "after:absolute after:inset-0 after:rounded-interactive after:content-[''] focus-visible:after:ring-2 focus-visible:after:ring-primary/60";
const RAISED = '-translate-y-0.5 shadow-elevation-3 ring-2 ring-primary/60 ring-offset-2 ring-offset-background';

export function MapPin({ step, current }: { step: HealthStep; current: boolean }) {
  const { dl, tx, openStep } = useLifecycleViewModel();
  const { node } = step;
  const look = VERDICT_LOOK[step.health];
  const tone = PILL_TONE[look.tone];
  const Glyph = stepGlyph(node.id);
  const VerdictGlyph = look.glyph;
  const label = stepLabel(dl, node.id, node.label);
  const spoken = tx(dl.lcx5_map_pin, { step: label, health: healthLabel(dl, step.health) });
  const pin = (
    <span
      className={`relative flex items-center transition-[transform,box-shadow] duration-200 motion-reduce:transition-none ${lcSurface('pin', `${PILL_STROKE[look.stroke]} ${tone.line} ${pillFilled(look.stroke) ? tone.wash : 'bg-background'}`)} ${current ? RAISED : ''}`}
      data-pin={node.id}
      data-health={step.health}
      data-current={current || undefined}
    >
      <Button
        variant="ghost"
        size="icon-sm"
        tabIndex={current ? 0 : -1}
        aria-label={spoken}
        aria-current={current ? 'step' : undefined}
        onClick={() => { if (!current) openStep(node.id); }}
        className={`hover:bg-transparent ${STRETCH}`}
        data-testid={`lc2-map-${node.id}`}
      >
        <Glyph className={`${GLYPH.sm} text-foreground`} aria-hidden />
      </Button>
      {current && <span className={`whitespace-nowrap pr-1.5 ${LT.label}`} aria-hidden>{label}</span>}
      <VerdictGlyph className={`${GLYPH.sm} mr-1 shrink-0 ${tone.ink}`} aria-hidden />
    </span>
  );
  return <li className="flex">{current ? pin : <Tooltip content={spoken} placement="bottom">{pin}</Tooltip>}</li>;
}
