/**
 * What floats over the training overlay's blueprint (spark
 * twin-portable-blueprint): the hand of cards, or in its place the notice that
 * setup is complete, the invitation to train, and the guide-down notice above
 * either. The layer itself lets clicks fall through to the blueprint; only the
 * `.tx-hand` column under each of these takes them.
 *
 * It sits in `blueprint/` beside the stage it floats on; everything it renders
 * is the experience's own (FUSION.md vocabulary), unchanged.
 */
import { useTranslation } from '@/i18n/useTranslation';

import { CompleteNotice, GuideDownNotice, TrainingInvite } from '../experience/table/Notices';
import { CardTable } from '../experience/table/CardTable';
import type { Turn } from '../experience/table/useTurn';
import type { SetupSessionApi, SetupVoiceApi } from '../setup/setupContract';
import { TRAINING_TOPIC_PRESETS } from '../sub_training/topicPresets';

interface StageHandProps {
  session: SetupSessionApi;
  voice: SetupVoiceApi;
  turn: Turn;
  /** The answer beat holds the hand off the table. */
  holding: boolean;
  /** The twin's name, for the setup-complete notice. */
  name: string;
  onClose: () => void;
  onFields: () => void;
}

export function StageHand({ session, voice, turn, holding, name, onClose, onFields }: StageHandProps) {
  const { t } = useTranslation();
  const topicKey = TRAINING_TOPIC_PRESETS.find((p) => p.id === session.topicPreset)?.labelKey ?? null;
  // Every slot set, by readiness. Not `score >= 100`: the score also counts the
  // Brain, which no question on this table fills.
  const setupDone = session.stage === 'setup' && session.checklist.every((c) => c.status === 'set');
  const memoriesInSetup = session.stage === 'setup' && session.focus === 'memories' && !setupDone;

  return (
    <div className="relative flex-1 min-h-0 flex flex-col pointer-events-none">
      {session.generatorError && (
        <div className="tx-hand flex-shrink-0 px-4 md:px-8 pt-4">
          <GuideDownNotice
            // A failed plan is retried by building it again; anything else
            // by dealing again from the plan that exists.
            onRetry={() => {
              if (session.plan?.status === 'failed') void session.rebuild();
              else session.redeal();
            }}
            onFields={onFields}
          />
        </div>
      )}
      {setupDone ? (
        <div className="tx-hand flex-1 min-h-0 overflow-y-auto px-4 md:px-8 py-6">
          <CompleteNotice name={name} onTrain={() => turn.chooseStage('training')} onClose={onClose} />
        </div>
      ) : memoriesInSetup ? (
        <div className="tx-hand flex-1 min-h-0 overflow-y-auto px-4 md:px-8 py-6">
          <TrainingInvite onStart={() => turn.chooseStage('training')} />
        </div>
      ) : (
        <CardTable
          session={session}
          voice={voice}
          turn={turn}
          topicLabel={topicKey ? t.twin.training[topicKey] : null}
          holding={holding}
        />
      )}
    </div>
  );
}

export default StageHand;
