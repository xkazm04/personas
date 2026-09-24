/**
 * Training the active twin: the session, its voice, and the three ways to
 * work — the TABLE (one question at a time, as cards), FIELDS (every slot
 * typed directly, which is also the way through while the guide is down),
 * and the batch STUDIO in the training stage. The style deck slides over any
 * of them and keeps drafting while the person plays on.
 *
 * `useSetupSession` is the only engine: readiness stays the one completion
 * authority, and nothing is written until a person keeps it.
 *
 * This file is now only the session and the choices made on it. The chrome
 * and the two panels it swaps are `TrainingFrame`, which holds the tab strips
 * BESIDE the regions they swap (census `tabstrip-with-no-declared-panel`).
 */

import { Suspense, useCallback, useEffect, useRef, useState } from 'react';
import { lazyRetry } from '@/lib/lazyRetry';
import { RouteChunkSkeleton } from '@/features/shared/components/layout/RouteChunkSkeleton';
import { useTranslation } from '@/i18n/useTranslation';
import { useSystemStore } from '@/stores/systemStore';
import type { TwinSlotId } from '../../../shared/twinStatus';
import type { SetupFocus, SetupStage } from '../../../setup/setupContract';
import { useSetupSession } from '../../../setup/useSetupSession';
import { useSetupVoice } from '../../../setup/useSetupVoice';
import { SetupFieldsPage } from '../../../setup/SetupFieldsPage';
import { useTrainingMomentum } from '../../../sub_training/useTrainingMomentum';
import { TablePlay } from './TablePlay';
import { TrainingFrame, type TrainingMode as Mode } from './TrainingFrame';
import { StyleSheet } from './StyleSheet';
import { useStyleDock } from './useStyleDock';
import { useTopicCoverage } from './useTopicCoverage';
import type { TopicCard } from './topicDeck';

const TrainingStudio = lazyRetry(() => import('../../../sub_training/TrainingStudio'));

interface TrainingTableProps {
  initialStage?: SetupStage;
  fresh: boolean;
  onClose: () => void;
  onOpenHub: () => void;
}

export function TrainingTable({ initialStage, fresh, onClose, onOpenHub }: TrainingTableProps) {
  const { t } = useTranslation();
  const xo = t.twin.experience_opus;
  const session = useSetupSession();
  const voice = useSetupVoice(session);
  const activeTwinId = useSystemStore((s) => s.activeTwinId);
  const dock = useStyleDock(activeTwinId, session.toneChannels);
  // Only the training deck reads these; the setup stage does not pay for them.
  const training = session.stage === 'training';
  const coverage = useTopicCoverage(training ? activeTwinId : null, session.history.length);
  const momentum = useTrainingMomentum(training ? activeTwinId : null, session.history.length);
  const [mode, setMode] = useState<Mode>('table');
  const [styleOpen, setStyleOpen] = useState(false);

  // A stage or topic the PERSON chose is dealt at once. The setters only
  // change what the next question is about, and `redeal` reads the session
  // after the render carrying the change — so the request is parked here and
  // fired by the effect, once no turn is in flight (a redeal mid-turn would be
  // dropped and the answer to the old turn would land on the new stage).
  const wantsDeal = useRef(false);
  const { stage, topic, busy, redeal, setStage, setTopic } = session;
  useEffect(() => {
    if (!wantsDeal.current || busy) return;
    wantsDeal.current = false;
    redeal();
  }, [stage, topic, busy, redeal]);

  const chooseStage = useCallback(
    (next: SetupStage) => {
      if (next === stage) return;
      wantsDeal.current = true;
      if (next === 'setup') setMode((m) => (m === 'studio' ? 'table' : m));
      setStage(next);
    },
    [stage, setStage],
  );

  useEffect(() => {
    if (initialStage) chooseStage(initialStage);
    // Once, for the stage the entry point asked for.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const pickTopic = useCallback(
    (card: TopicCard, prompt: string) => {
      // The same topic again changes nothing the effect watches, so a parked
      // request would wait for the NEXT turn to settle and replace it. The
      // session already holds this topic: deal now.
      if (topic === prompt) {
        redeal();
        return;
      }
      wantsDeal.current = true;
      setTopic(prompt, card.id);
    },
    [topic, redeal, setTopic],
  );

  const askGuide = useCallback(
    (slot: SetupFocus) => {
      setMode('table');
      session.focusOn(slot);
    },
    [session],
  );

  const twinName = session.values.name || xo.twinCard.unnamed;
  const openHub = (_slot: TwinSlotId) => onOpenHub();

  return (
    <TrainingFrame
      twinName={twinName}
      session={session}
      voice={voice}
      mode={mode}
      onModeChange={setMode}
      onStageChange={chooseStage}
      styleOpen={styleOpen}
      onToggleStyle={() => setStyleOpen((open) => !open)}
      onClose={onClose}
    >
      {mode === 'table' && (
        <TablePlay
          session={session}
          voice={voice}
          twinName={twinName}
          fresh={fresh}
          dock={dock}
          coverage={coverage}
          momentum={momentum}
          onPickTopic={pickTopic}
          onStartTraining={() => chooseStage('training')}
          onOpenStyle={() => setStyleOpen(true)}
          onOpenFields={() => setMode('fields')}
          onOpenHub={openHub}
          onClose={onClose}
        />
      )}
      {mode === 'fields' && (
        <SetupFieldsPage session={session} values={session.values} jump={null} onOpenHub={openHub} onAskGuide={askGuide} />
      )}
      {mode === 'studio' && (
        <Suspense fallback={<RouteChunkSkeleton showActions={false} />}>
          <TrainingStudio onExit={() => setMode('table')} />
        </Suspense>
      )}
      <StyleSheet open={styleOpen} dock={dock} onClose={() => setStyleOpen(false)} />
    </TrainingFrame>
  );
}

export default TrainingTable;
