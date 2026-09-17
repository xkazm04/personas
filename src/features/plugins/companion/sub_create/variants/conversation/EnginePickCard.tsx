import Button from '@/features/shared/components/buttons/Button';
import { StatusBadge } from '@/features/shared/components/display/StatusBadge';
import { useTranslation } from '@/i18n/useTranslation';
import type { TtsEngineId } from '@/api/companion';
import type { CreateAthenaCard, CreateAthenaEngine } from '../../engine/createAthenaTypes';

type EnginePickData = Extract<CreateAthenaCard, { kind: 'engine_pick' }>;

/**
 * Two engine tiles (Kokoro / Pocket TTS) with an installed badge each; the
 * recommended one carries the pill and the why. Selecting is instant,
 * "Use this engine" confirms, then Continue.
 */
export function EnginePickCard({ card, engine }: { card: EnginePickData; engine: CreateAthenaEngine }) {
  const { t } = useTranslation();
  const c = t.plugins.companion;
  const { actions, canNext } = engine;

  const copy: Record<TtsEngineId, { title: string; desc: string }> = {
    kokoro: { title: c.create_engine_kokoro_title, desc: c.create_engine_kokoro_desc },
    pocket_tts: { title: c.create_engine_pocket_title, desc: c.create_engine_pocket_desc },
  };

  return (
    <>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
        {card.options.map((opt) => {
          const selected = card.selected === opt.id;
          const recommended = card.recommended === opt.id;
          return (
            <button
              key={opt.id}
              type="button"
              aria-pressed={selected}
              onClick={() => actions.selectEngine(opt.id)}
              data-testid={`create-athena-engine-${opt.id}`}
              className={`text-left rounded-interactive border p-3 flex flex-col gap-1.5 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50 ${
                selected
                  ? 'border-primary bg-primary/15'
                  : 'border-foreground/10 bg-background/60 hover:bg-secondary/60'
              }`}
            >
              <div className="flex items-center justify-between gap-2">
                <span className="typo-label text-foreground">{copy[opt.id].title}</span>
                <StatusBadge variant={opt.installed ? 'success' : 'neutral'} size="sm" pill>
                  {opt.installed ? c.create_engine_installed : c.create_engine_needs_install}
                </StatusBadge>
              </div>
              <span className="typo-caption text-foreground/85">{copy[opt.id].desc}</span>
              {recommended && (
                <span className="flex flex-col gap-1 pt-1">
                  <StatusBadge accent="emerald" size="sm" pill className="self-start">
                    {c.create_recommended}
                  </StatusBadge>
                  <span className="typo-caption text-foreground/85">{card.why}</span>
                </span>
              )}
            </button>
          );
        })}
      </div>
      <div className="flex justify-end gap-2">
        <Button
          variant={card.confirmed ? 'secondary' : 'primary'}
          size="sm"
          aria-pressed={card.confirmed}
          onClick={actions.confirmEngine}
          data-testid="create-athena-engine-choose"
        >
          {c.create_engine_choose}
        </Button>
        <Button
          variant={card.confirmed ? 'primary' : 'secondary'}
          size="sm"
          disabled={!canNext}
          onClick={actions.next}
          data-testid="create-athena-next"
        >
          {c.create_next}
        </Button>
      </div>
    </>
  );
}
