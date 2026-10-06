/**
 * Fusion · decision v2 - one answer as an Overview tile: the kit's band tile
 * with its rail in the choice's ink, a tinted icon tile for what the choice
 * DOES (`actionGlyph`) with that effect as a lamp line under it - the
 * annunciator's "● NEEDS YOU" recipe - and its key cap in the corner, as
 * Mission Control's tiles carry theirs. Then the choice itself, tinted the
 * way the app tints a title, and its consequence.
 *
 * Her pick (once she has said it, by the product's reveal rule) is lit in
 * Athena's brand: the rail runs from the accent into the AI violet, the edge
 * glows, and a seal row states her label, her Enter key and her one-line why.
 * An approval's safe pick is the product's risk read, not her word: the same
 * row in the success ink with a shield, no face.
 *
 * TODO(prototype, 2026-10-07): athena decision surface round 6 - consolidate after the owner picks.
 */

import { ShieldCheck } from 'lucide-react';
import Button from '@/features/shared/components/buttons/Button';
import type { CardChoice, CardRecommendation } from '../../../c/bodies/model';
import { AthenaSeal } from '../../AthenaSeal';
import { inline } from '../../text';
import { actionGlyph, toneInk } from './actionGlyph';

export function AnswerTile({
  choice,
  index,
  rec,
  herOwn,
  disabled,
  chosen,
  compact,
  onChoose,
}: {
  choice: CardChoice;
  index: number;
  rec: CardRecommendation | null;
  herOwn: boolean;
  disabled: boolean;
  chosen: boolean;
  /** Four or more answers: a row-shaped tile, the choice one step smaller. */
  compact: boolean;
  onChoose: () => void;
}) {
  const { Glyph, effect } = actionGlyph(choice);
  const pick = choice.recommended && !!rec?.revealed;
  const state = pick ? (herOwn ? ' is-pick' : ' is-safe') : '';
  const titleInk = choice.tone === 'danger' ? 'text-status-error' : choice.tone === 'neutral' ? 'text-foreground' : '';
  return (
    <Button
      variant="ghost"
      className={`k-dtile d2-ans focus-ring${state}${chosen ? ' is-chosen' : ''}`}
      style={{ ['--t' as string]: toneInk(choice.tone) }}
      data-fusion-answer=""
      data-card-choice=""
      data-testid={`companion-fusion-d2-answer-${index + 1}`}
      aria-keyshortcuts={index < 9 ? String(index + 1) : undefined}
      disabled={disabled}
      loading={choice.busy}
      onClick={onChoose}
    >
      <span className="d2-ans-head">
        <span className="d2-icon" aria-hidden>
          <Glyph />
        </span>
        <span className="d2-effect typo-eyebrow">
          <span className="d2-lamp" aria-hidden />
          {effect}
        </span>
        {index < 9 && <kbd className="d2-key is-corner typo-code">{index + 1}</kbd>}
      </span>
      <Glyph className="d2-art" aria-hidden />
      <span className={`d2-ans-title ${compact ? 'typo-title' : 'typo-title-lg'} ${titleInk}`}>{inline(choice.label)}</span>
      {choice.hint && <span className="d2-ans-hint typo-caption">{choice.hint}</span>}
      {pick && rec && (
        <span className="d2-her" data-testid={herOwn ? 'companion-fusion-d2-her-pick' : 'companion-fusion-d2-safe-pick'}>
          <span className="d2-her-head">
            {herOwn ? <AthenaSeal size={28} /> : <ShieldCheck className="d2-her-shield" aria-hidden />}
            <span className={`typo-label ${herOwn ? 'd2-her-label' : 'text-status-success'}`}>{rec.label}</span>
            <kbd className="d2-key typo-code">Enter</kbd>
          </span>
          {rec.text && <span className="typo-body text-foreground">{rec.text}</span>}
        </span>
      )}
    </Button>
  );
}
