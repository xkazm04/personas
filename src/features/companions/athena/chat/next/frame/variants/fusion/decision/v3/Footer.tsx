/**
 * Fusion · decision v3 - the palette's footer bar under the question: on the
 * left the door to her opinion (Ask Athena · 0, then "She is weighing it",
 * then ↵ Take her pick once her pick sits on a row), on the right the legend
 * of the keys that pick (↑↓ move, 1-n choose) and the ways past the item
 * (Space set aside, the product's Later / Skip).
 *
 * TODO(prototype, 2026-10-07): athena decision surface round 6 - keep the owner's pick, delete the rest.
 */

import { ShieldAlert } from 'lucide-react';
import Button from '@/features/shared/components/buttons/Button';
import { Tooltip } from '@/features/shared/components/display/Tooltip';
import { useMotion } from '@/hooks/utility/interaction/useMotion';
import type { CardModel } from '../../../c/bodies/model';
import { AthenaSeal } from '../../AthenaSeal';
import { FUSION_COPY as F } from '../../copy';
import type { QueueNav } from '../../DecisionStage';
import { AsideKey, Keycap, Legend } from './parts';
import { PALETTE_COPY as P } from './copy';

function HerDoor({ model }: { model: CardModel }) {
  const { shouldAnimate } = useMotion();
  const rec = model.recommendation;
  if (!rec) return null;
  if (rec.revealed && model.choices.some((c) => c.recommended)) {
    return (
      <span className="fd3-door is-quiet typo-caption" data-testid="companion-fusion-d3-take">
        <Keycap>{P.keys.enter}</Keycap>
        {P.takePick}
      </span>
    );
  }
  if (rec.composing) {
    return (
      <span className={`fd3-door is-weighing typo-body${shouldAnimate ? ' is-moving' : ''}`} aria-busy>
        <AthenaSeal size={22} />
        {F.composing}
      </span>
    );
  }
  if (rec.failed) return <span className="typo-body text-status-warning">{rec.failed}</span>;
  if (!rec.reveal || rec.revealed) return null;
  return (
    <Button
      variant="ghost"
      className="fd3-door is-ask typo-body"
      onClick={rec.reveal}
      aria-keyshortcuts="0"
      data-testid="companion-fusion-d3-ask"
    >
      <AthenaSeal size={22} />
      {F.askHer}
      <Keycap>{P.keys.ask}</Keycap>
    </Button>
  );
}

/** Her word when it lands on no row (an approval read as elevated risk). */
export function Verdict({ model, herOwn }: { model: CardModel; herOwn: boolean }) {
  const rec = model.recommendation;
  if (!rec?.revealed || !rec.text || model.choices.some((c) => c.recommended)) return null;
  return (
    <p className="fd3-verdict" data-testid="companion-fusion-d3-verdict">
      {herOwn ? <AthenaSeal size={22} /> : <ShieldAlert className="fd3-verdict-g" aria-hidden />}
      <span className="min-w-0">
        <span className="typo-label text-status-warning block">{rec.label}</span>
        <span className="typo-body text-foreground">{rec.text}</span>
      </span>
    </p>
  );
}

export function Footer({ model, nav }: { model: CardModel; nav: QueueNav }) {
  const n = model.choices.length;
  return (
    <footer className="fd3-foot">
      <HerDoor model={model} />
      <span className="flex-1" />
      {n > 1 && <Legend keys={[P.keys.up, P.keys.down]} label={P.move} />}
      {n > 0 && <Legend keys={[P.range(n)]} label={P.choose} />}
      {n > 0 && <span className="fd3-foot-rule" aria-hidden />}
      <AsideKey nav={nav} />
      {model.deferrals.map((d) => (
        <Tooltip key={d.key} content={d.hint}>
          <Button variant="ghost" size="xs" className="fd3-keybtn typo-caption" onClick={d.run}>
            {d.label}
          </Button>
        </Tooltip>
      ))}
    </footer>
  );
}
