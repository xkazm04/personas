import { useTranslation } from '@/i18n/useTranslation';
import Button from '@/features/shared/components/buttons/Button';
import type { TtsEngineId } from '@/api/companion';
import type { CreateAthenaActions, CreateAthenaCard, EngineOption } from '../../engine/createAthenaTypes';
import { ChoiceTile } from './ChoiceTile';

type EnginePick = Extract<CreateAthenaCard, { kind: 'engine_pick' }>;

/**
 * engine_pick — one tile per TTS engine (installed / needs-install badge,
 * recommended pill + reason), then a single confirm.
 */
export function EnginePickCard({ card, actions }: { card: EnginePick; actions: CreateAthenaActions }) {
  const { t } = useTranslation();
  const c = t.plugins.companion;

  const copy: Record<TtsEngineId, { title: string; desc: string }> = {
    kokoro: { title: c.create_engine_kokoro_title, desc: c.create_engine_kokoro_desc },
    pocket_tts: { title: c.create_engine_pocket_title, desc: c.create_engine_pocket_desc },
  };

  const badge = (option: EngineOption) => (
    <span
      className={`typo-label rounded-pill px-2 py-0.5 ${
        option.installed ? 'bg-status-success/10 text-status-success' : 'bg-secondary/60 text-foreground'
      }`}
    >
      {option.installed ? c.create_engine_installed : c.create_engine_needs_install}
    </span>
  );

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-3 sm:flex-row">
        {card.options.map((option) => {
          const recommended = option.id === card.recommended;
          return (
            <ChoiceTile
              key={option.id}
              title={copy[option.id].title}
              description={copy[option.id].desc}
              selected={option.id === card.selected}
              recommendedLabel={recommended ? c.create_recommended : null}
              why={recommended ? card.why : null}
              badge={badge(option)}
              onSelect={() => actions.selectEngine(option.id)}
              testId={`create-athena-engine-${option.id}`}
            />
          );
        })}
      </div>
      <div>
        <Button
          variant={card.confirmed ? 'secondary' : 'primary'}
          size="lg"
          onClick={actions.confirmEngine}
          data-testid="create-athena-engine-choose"
        >
          {c.create_engine_choose}
        </Button>
      </div>
    </div>
  );
}
