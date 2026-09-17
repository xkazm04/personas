import { ArrowLeft } from 'lucide-react';
import Button from '@/features/shared/components/buttons/Button';
import { useTranslation } from '@/i18n/useTranslation';
import type { CreateAthenaEngine } from '../../engine/createAthenaTypes';
import { StageCardHandoff, StageCardIntro, StageCardOrbPlace } from './StageCardSimple';
import { StageCardKeepToggle } from './StageCardKeepToggle';
import { StageCardEnginePick, StageCardInstall } from './StageCardEngine';
import { StageCardVoice } from './StageCardVoice';
import { StageCardStt } from './StageCardStt';

/**
 * The card — the Stage's primary object. One elevated panel whose body
 * switches on `card.kind`; the footer carries the shared navigation
 * (Back · Skip for now · Continue). The intro and handoff cards own their
 * single primary action, so they hide the Skip/Continue pair.
 */
export interface StageCardProps {
  engine: CreateAthenaEngine;
}

function CardBody({ engine }: StageCardProps) {
  const { card, actions } = engine;
  switch (card.kind) {
    case 'intro':
      return <StageCardIntro card={card} actions={actions} />;
    case 'keep_toggle':
      return <StageCardKeepToggle card={card} actions={actions} />;
    case 'orb_place':
      return <StageCardOrbPlace card={card} actions={actions} />;
    case 'engine_pick':
      return <StageCardEnginePick card={card} actions={actions} />;
    case 'install':
      return <StageCardInstall card={card} actions={actions} />;
    case 'voice_pick':
      return <StageCardVoice card={card} actions={actions} />;
    case 'stt':
      return <StageCardStt card={card} actions={actions} />;
    case 'handoff':
      return <StageCardHandoff card={card} actions={actions} />;
  }
}

export function StageCard({ engine }: StageCardProps) {
  const { t } = useTranslation();
  const c = t.plugins.companion;
  const { card, actions, canBack, canNext } = engine;
  const terminal = card.kind === 'intro' || card.kind === 'handoff';
  const nextLabel = card.kind === 'voice_pick' ? c.create_voice_choose : c.create_next;

  return (
    <section
      className="w-full max-w-[640px] rounded-card shadow-elevation-2 bg-secondary/30 border border-foreground/10"
      data-testid={`create-athena-card-${card.kind}`}
      aria-live="polite"
    >
      <div className="p-6">
        <CardBody engine={engine} />
      </div>
      {(canBack || !terminal) && (
        <footer className="flex items-center gap-2 px-4 py-3 border-t border-foreground/10">
          {canBack && (
            <Button
              variant="ghost"
              size="sm"
              icon={<ArrowLeft className="w-4 h-4" aria-hidden="true" />}
              onClick={actions.back}
              data-testid="create-athena-back"
            >
              {c.create_back}
            </Button>
          )}
          {!terminal && (
            <div className="ml-auto flex items-center gap-2">
              <Button variant="ghost" size="sm" onClick={actions.skip} data-testid="create-athena-skip">
                {c.create_skip}
              </Button>
              <Button
                variant="primary"
                size="sm"
                disabled={!canNext}
                onClick={actions.next}
                data-testid="create-athena-next"
              >
                {nextLabel}
              </Button>
            </div>
          )}
        </footer>
      )}
    </section>
  );
}
