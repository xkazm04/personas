/**
 * Fusion · decision v1 · the door to Athena's opinion, in the review card's
 * action zone. Closed: "Ask Athena" with her seal and its key (0). While she
 * composes: her seal breathing beside a calm status line (never a spinner on
 * a surface). Failed: the product's failure line. Revealed: her verdict lands
 * ON the card she picks (`OptionCard`), so the door steps aside - unless no
 * card can carry it (a static risk read with no safe answer), where it reads
 * here as the app's inline callout.
 *
 * TODO(prototype, 2026-10-07): athena decision surface round 6 - keep the owner's pick, delete the rest.
 */

import { ShieldAlert, ShieldCheck, Sparkles } from 'lucide-react';
import Button from '@/features/shared/components/buttons/Button';
import { Tooltip } from '@/features/shared/components/display/Tooltip';
import { useMotion } from '@/hooks/utility/interaction/useMotion';
import type { CardModel } from '../../../c/bodies/model';
import { DESK_COPY as C } from './copy';

export function Seal({ size = 24, live = false }: { size?: number; live?: boolean }) {
  return (
    <span className={`d1-seal${live ? ' is-live' : ''}`} style={{ width: size, height: size }} aria-hidden>
      <span className="d1-portrait" />
    </span>
  );
}

export function HerDoor({ model, herOwn }: { model: CardModel; herOwn: boolean }) {
  const { shouldAnimate } = useMotion();
  const rec = model.recommendation;
  if (!rec) return null;
  if (rec.revealed) {
    // On a card already: the card is the verdict, the zone points at it.
    const at = model.choices.findIndex((c) => c.recommended);
    if (at >= 0) {
      const why = model.choices.length > 3 && rec.text;
      return (
        <>
          <span className="d1-pointer" style={{ ['--t' as string]: herOwn ? 'var(--primary)' : 'var(--status-success)' }} data-testid="companion-fusion-d1-pointer">
            {herOwn ? <Seal size={22} /> : <ShieldCheck className="d1-pointer-g" aria-hidden />}
            <span className={`typo-label ${herOwn ? 'text-primary' : 'text-status-success'}`}>{herOwn ? C.recommends : C.safe}</span>
            <kbd className="d1-cap is-sm typo-code">{at + 1}</kbd>
            <span className="d1-pointer-sep" aria-hidden />
            <kbd className="d1-kbd typo-code">Enter</kbd>
            <span className="typo-caption">{C.takeIt}</span>
          </span>
          {/* Many cards: the pick's card keeps only her seal, her why reads here, under the zone. */}
          {why && <span className="d1-foot-why typo-caption text-foreground">{why}</span>}
        </>
      );
    }
    if (!rec.text) return null;
    return (
      <p className={`d1-callout${herOwn ? '' : ' is-warn'}`} data-testid="companion-fusion-d1-verdict">
        {herOwn ? <Seal size={24} /> : <ShieldAlert aria-hidden />}
        <span className="min-w-0">
          <span className={`typo-label block ${herOwn ? 'text-primary' : 'text-status-warning'}`}>{herOwn ? C.recommends : rec.label}</span>
          <span className="typo-body text-foreground">{rec.text}</span>
        </span>
      </p>
    );
  }
  if (rec.composing) {
    return (
      <p className="d1-composing" aria-busy role="status" data-testid="companion-fusion-d1-composing">
        <Seal size={28} live={shouldAnimate} />
        <span className="min-w-0">
          <span className="typo-label text-primary block">{C.composing}</span>
          <span className="typo-caption">{C.composingSub}</span>
        </span>
      </p>
    );
  }
  return (
    <span className="d1-door">
      {rec.reveal && (
        <Tooltip content={C.askHint}>
          <Button variant="secondary" size="sm" className="d1-ask" onClick={rec.reveal} aria-keyshortcuts="0" data-testid="companion-fusion-d1-ask">
            <Seal size={22} />
            <span className="typo-body text-foreground">{C.askHer}</span>
            <Sparkles className="d1-ask-spark" aria-hidden />
            <kbd className="d1-kbd typo-code">0</kbd>
          </Button>
        </Tooltip>
      )}
      {rec.failed && <span className="typo-caption text-status-warning" role="alert">{rec.failed}</span>}
    </span>
  );
}
