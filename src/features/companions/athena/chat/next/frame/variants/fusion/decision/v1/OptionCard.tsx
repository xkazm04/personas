/**
 * Fusion · decision v1 · one answer as the review world's option card: the
 * kit band on a 2px rail in the answer's tone (Manual Review's decision
 * cards carry their category the same way), a leading key cap that IS its
 * key, the choice as a `typo-heading` title and its consequence under it.
 * The card Athena recommends gains her provenance strip on its foot - her
 * seal, "Athena recommends", her one-line why, and Enter - and its rail
 * lights in the accent; an approval's safe answer gets the same strip in the
 * success ink without her face (it is the product's risk read, not her word).
 * A picked card confirms: its key cap turns to a check in its tone.
 *
 * TODO(prototype, 2026-10-07): athena decision surface round 6 - keep the owner's pick, delete the rest.
 */

import { Check, ShieldCheck, Sparkles } from 'lucide-react';
import Button from '@/features/shared/components/buttons/Button';
import { Tooltip } from '@/features/shared/components/display/Tooltip';
import type { CardChoice, CardRecommendation } from '../../../c/bodies/model';
import { inline } from '../../text';
import { DESK_COPY as C } from './copy';
import { Seal } from './HerDoor';

const TONE: Record<CardChoice['tone'], string> = {
  primary: 'var(--primary)',
  danger: 'var(--status-error)',
  neutral: 'var(--muted-foreground)',
};

function Strip({ rec, herOwn, brief }: { rec: CardRecommendation; herOwn: boolean; brief: boolean }) {
  const testId = herOwn ? 'companion-fusion-d1-her-pick' : 'companion-fusion-d1-safe-pick';
  const mark = herOwn ? <Seal size={22} /> : <ShieldCheck className="d1-strip-g" aria-hidden />;
  // Many cards: a corner mark (her seal and Enter); her label and why read in the action zone.
  if (brief) {
    return (
      <span className="d1-corner" data-testid={testId}>
        {mark}
        <kbd className="d1-kbd typo-code">Enter</kbd>
      </span>
    );
  }
  return (
    <span className="d1-strip" data-testid={testId}>
      <span className="d1-strip-head">
        {mark}
        <span className={`typo-label ${herOwn ? 'text-primary' : 'text-status-success'}`}>{herOwn ? C.recommends : C.safe}</span>
        {herOwn && <Sparkles className="d1-strip-spark" aria-hidden />}
        <span className="flex-1" />
        <kbd className="d1-kbd typo-code">Enter</kbd>
      </span>
      {rec.text && <span className="d1-strip-why typo-caption text-foreground">{rec.text}</span>}
    </span>
  );
}

export function OptionCard({
  choice,
  index,
  rec,
  herOwn,
  disabled,
  picked,
  brief,
  onPick,
}: {
  choice: CardChoice;
  index: number;
  rec: CardRecommendation | null;
  herOwn: boolean;
  disabled: boolean;
  picked: boolean;
  /** Many cards: her mark shrinks to the corner; her why reads in the action zone. */
  brief: boolean;
  onPick: () => void;
}) {
  const pick = choice.recommended && !!rec?.revealed;
  const cls = ['d1-opt', pick && (herOwn ? 'is-pick' : 'is-safe'), picked && 'is-picked'].filter(Boolean).join(' ');
  const card = (
    <Button
      variant="ghost"
      className={cls}
      style={{ ['--t' as string]: TONE[choice.tone] }}
      data-fusion-answer=""
      data-card-choice=""
      data-testid={`companion-fusion-d1-answer-${index + 1}`}
      aria-keyshortcuts={index < 9 ? String(index + 1) : undefined}
      disabled={disabled}
      loading={choice.busy}
      onClick={() => {
        onPick();
        void choice.run();
      }}
    >
      <span className="d1-opt-main">
        <kbd className="d1-cap typo-data" aria-hidden>
          {picked ? <Check /> : index < 9 ? index + 1 : '·'}
        </kbd>
        <span className="d1-opt-text">
          <span className="d1-opt-title typo-heading text-foreground">{inline(choice.label)}</span>
          {choice.hint && <span className="d1-opt-hint typo-caption">{choice.hint}</span>}
        </span>
      </span>
      {pick && rec && <Strip rec={rec} herOwn={herOwn} brief={brief} />}
    </Button>
  );
  // Many cards keep to one line each; the whole answer reads on hover and focus.
  return brief ? <Tooltip content={choice.hint ? `${choice.label} - ${choice.hint}` : choice.label}>{card}</Tooltip> : card;
}
