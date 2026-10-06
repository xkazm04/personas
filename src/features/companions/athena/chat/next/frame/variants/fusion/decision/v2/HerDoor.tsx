/**
 * Fusion · decision v2 - the door to her opinion on the hero tile's foot:
 * "Ask Athena · 0" with her seal before she has spoken; her seal turning in
 * its ring while she weighs it; the failure in the warning ink (the door stays
 * open to ask again); and, when she has spoken but no answer tile carries it
 * (a verdict that names no listed choice), her word here. An approval's
 * risk read rides on the stakes chip instead.
 *
 * TODO(prototype, 2026-10-07): athena decision surface round 6 - consolidate after the owner picks.
 */

import Button from '@/features/shared/components/buttons/Button';
import { useMotion } from '@/hooks/utility/interaction/useMotion';
import type { CardModel } from '../../../c/bodies/model';
import { AthenaSeal } from '../../AthenaSeal';
import { FUSION_COPY as F } from '../../copy';

export function HerDoor({ model, herOwn }: { model: CardModel; herOwn: boolean }) {
  const { shouldAnimate } = useMotion();
  const rec = model.recommendation;
  if (!rec) return null;
  if (rec.revealed && rec.text) {
    // Carried by her pick's tile, or (an approval's risk read) by the stakes chip.
    if (!herOwn || model.choices.some((c) => c.recommended)) return null;
    return (
      <p className="d2-verdict" data-testid="companion-fusion-d2-verdict">
        <AthenaSeal size={30} />
        <span className="d2-verdict-body">
          <span className="typo-label d2-her-label">{rec.label}</span>
          <span className="typo-body text-foreground">{rec.text}</span>
        </span>
      </p>
    );
  }
  if (rec.composing) {
    return (
      <p className="d2-verdict" aria-busy data-testid="companion-fusion-d2-composing">
        <span className={`fu-mark is-live${shouldAnimate ? ' is-moving' : ''}`} aria-hidden>
          <span className="fu-face" />
          <span className="fu-ring" />
        </span>
        <span className="d2-verdict-body">
          <span className="typo-eyebrow text-primary">{F.composing}</span>
          {rec.composing !== F.composing && <span className="typo-caption">{rec.composing}</span>}
        </span>
      </p>
    );
  }
  return (
    <>
      {rec.reveal && (
        <Button
          variant="ghost"
          className="d2-ask focus-ring"
          onClick={rec.reveal}
          aria-keyshortcuts="0"
          data-testid="companion-fusion-d2-ask"
        >
          <AthenaSeal size={28} />
          <span className="typo-title text-foreground">{F.askHer}</span>
          <kbd className="d2-key typo-code">0</kbd>
        </Button>
      )}
      {rec.failed && (
        <p className="typo-body text-status-warning" role="alert">
          {rec.failed}
        </p>
      )}
    </>
  );
}
