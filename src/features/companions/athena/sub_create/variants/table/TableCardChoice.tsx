import type { ReactNode } from 'react';
import Button from '@/features/shared/components/buttons/Button';
import { AccessibleToggle } from '@/features/shared/components/forms/AccessibleToggle';
import { useTranslation } from '@/i18n/useTranslation';
import type { TtsEngineId } from '@/api/companion';
import type { CreateAthenaCard, CreateAthenaEngine } from '../../engine/createAthenaTypes';
import { useStepLabel } from '../stage/StageRail';
import { digitAction } from './tableKeys';

/**
 * The settling cards - keep or turn off a chrome feature, confirm the orb's
 * home, choose the voice engine. Each option carries its key; a pick folds
 * the card into a receipt and moves on (`digitAction`), so the mouse and the
 * keyboard run the same code.
 */
type CardOf<K extends CreateAthenaCard['kind']> = Extract<CreateAthenaCard, { kind: K }>;

export function TableOpt({ n, title, desc, tag, pressed, onPick, testId }: {
  n: number;
  title: ReactNode;
  desc?: ReactNode;
  tag?: ReactNode;
  pressed: boolean;
  onPick: () => void;
  testId: string;
}) {
  return (
    <Button variant="ghost" className="tb-opt" aria-pressed={pressed} onClick={onPick} data-testid={testId}>
      <kbd>{n}</kbd>
      <span className="typo-heading">{title}</span>
      {tag && <span className="tb-opt-tag typo-body">{tag}</span>}
      {desc && <span className="tb-opt-d typo-body">{desc}</span>}
    </Button>
  );
}

export function TableCardKeep({ engine, card }: { engine: CreateAthenaEngine; card: CardOf<'keep_toggle'> }) {
  const { t } = useTranslation();
  const c = t.athena;
  const label = useStepLabel()(card.feature);
  const run = (n: number) => digitAction(engine, n)?.();
  const rec = (which: 'keep' | 'off') => (card.recommended === which ? c.create_recommended : undefined);
  return (
    <>
      <div className="tb-toggle typo-body">
        <span>{card.why}</span>
        <AccessibleToggle
          checked={card.enabled}
          onChange={() => engine.actions.keepFeature(card.feature, !card.enabled)}
          label={label}
          data-testid="create-athena-keep-toggle"
        />
      </div>
      <div className="tb-opts two" role="group" aria-label={label}>
        <TableOpt n={1} title={c.create_keep} tag={rec('keep')} pressed={card.choice === 'keep'} onPick={() => run(1)} testId="create-athena-keep" />
        <TableOpt n={2} title={c.create_turn_off} tag={rec('off')} pressed={card.choice === 'off'} onPick={() => run(2)} testId="create-athena-turn-off" />
      </div>
      {card.feature === 'chime' && (
        <div className="tb-opts">
          <TableOpt n={3} title={c.create_chime_play} pressed={false} onPick={() => run(3)} testId="create-athena-chime-replay" />
        </div>
      )}
    </>
  );
}

export function TableCardOrbPlace({ engine, card }: { engine: CreateAthenaEngine; card: CardOf<'orb_place'> }) {
  const { t } = useTranslation();
  return (
    <div className="tb-opts">
      <TableOpt
        n={1}
        title={t.athena.create_orb_place_done}
        pressed={card.confirmed}
        onPick={() => digitAction(engine, 1)?.()}
        testId="create-athena-orb-place-done"
      />
    </div>
  );
}

export function TableCardEngine({ engine, card }: { engine: CreateAthenaEngine; card: CardOf<'engine_pick'> }) {
  const { t } = useTranslation();
  const c = t.athena;
  const copy: Record<TtsEngineId, { title: string; desc: string }> = {
    kokoro: { title: c.create_engine_kokoro_title, desc: c.create_engine_kokoro_desc },
    pocket_tts: { title: c.create_engine_pocket_title, desc: c.create_engine_pocket_desc },
  };
  return (
    <>
      <div className="tb-opts two" role="radiogroup" aria-label={c.create_step_voice_engine}>
        {card.options.map((opt, i) => (
          <TableOpt
            key={opt.id}
            n={i + 1}
            title={copy[opt.id].title}
            tag={opt.id === card.recommended ? c.create_recommended : undefined}
            desc={`${copy[opt.id].desc} ${opt.installed ? c.create_engine_installed : c.create_engine_needs_install}`}
            pressed={card.confirmed && card.selected === opt.id}
            onPick={() => digitAction(engine, i + 1)?.()}
            testId={`create-athena-engine-${opt.id}`}
          />
        ))}
      </div>
      <p className="tb-card-hint typo-body">{card.why}</p>
    </>
  );
}
