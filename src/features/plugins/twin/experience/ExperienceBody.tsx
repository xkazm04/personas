/**
 * The experience's two phases, one surface: FORGE a twin, then play it at the
 * TABLE — with no page, tab or dialog change between them.
 *
 * It owns the session (one engine, never two), the turn, and which door is
 * open. Only one layer is ever open: every door shares a single value, so
 * "one act at a time" is structural rather than remembered.
 *
 * A `train` request opens straight on the table for the active twin; with no
 * twin active there is nothing to train, so it opens on the forge instead.
 */

import { useCallback, useEffect, useState } from 'react';
import { SegmentedTabs, segmentedTabPanelProps } from '@/features/shared/components/layout/SegmentedTabs';
import { useTranslation } from '@/i18n/useTranslation';
import { useSystemStore } from '@/stores/systemStore';
import type { SetupFocus, SetupStage } from '../setup/setupContract';
import { useSetupSession } from '../setup/useSetupSession';
import { useSetupVoice } from '../setup/useSetupVoice';
import { useTrainingMomentum } from '../sub_training/useTrainingMomentum';
import { TRAINING_TOPIC_PRESETS } from '../sub_training/useTrainingSession';
import type { TwinSlotId } from '../shared/twinStatus';
import type { ExperienceRequest } from './launcher';
import { EXPERIENCE_TITLE_ID } from './experienceIds';
import { ForgePhase } from './forge/ForgePhase';
import { CardTable } from './table/CardTable';
import { TableChrome, type ExperienceDoor } from './table/TableChrome';
import { TableProgress } from './table/TableProgress';
import { CompleteNotice, GuideDownNotice, TrainingInvite } from './table/Notices';
import { useTurn } from './table/useTurn';
import { DeckLayer } from './layers/DeckLayer';
import { FieldsLayer } from './layers/FieldsLayer';
import { SheetLayer } from './layers/SheetLayer';
import { VoiceLayer } from './layers/VoiceLayer';
import { useCoverage } from './layers/useCoverage';
import { useVoiceDock } from './layers/useVoiceDock';
import './experience.css';

/** The stage strip's id prefix, shared by the strip and the panel it controls. */
const STAGE_TABS_ID = 'twin-experience-stage';

interface ExperienceBodyProps {
  request: ExperienceRequest;
  onClose: () => void;
  onOpenHub: () => void;
}

export default function ExperienceBody({ request, onClose, onOpenHub }: ExperienceBodyProps) {
  const { t, tx: fmt } = useTranslation();
  const tx = t.twin.experience;
  const session = useSetupSession();
  const voice = useSetupVoice(session);
  const turn = useTurn(session);

  const activeTwinId = useSystemStore((s) => s.activeTwinId);
  const profile = useSystemStore((s) => s.twinProfiles.find((p) => p.id === s.activeTwinId) ?? null);
  const dock = useVoiceDock(activeTwinId, session.toneChannels);
  // Only the training deck reads these; the setup stage does not pay for them.
  const training = session.stage === 'training';
  const coverage = useCoverage(training ? activeTwinId : null, session.history.length);
  const momentum = useTrainingMomentum(training ? activeTwinId : null, session.history.length);

  const [phase, setPhase] = useState<'forge' | 'play'>(() =>
    request.mode === 'create' || !activeTwinId ? 'forge' : 'play',
  );
  const [door, setDoor] = useState<ExperienceDoor | null>(null);

  const { chooseStage } = turn;
  useEffect(() => {
    if (request.mode === 'train' && request.stage) chooseStage(request.stage);
    // Once, for the stage the entry point asked for.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /** A voice chosen in the forge is already drafting: show the person where. */
  const onCreated = useCallback(({ withStyle }: { withStyle: boolean }) => {
    if (withStyle) setDoor('studio');
    setPhase('play');
  }, []);

  const askGuide = useCallback(
    (slot: SetupFocus) => {
      setDoor(null);
      session.focusOn(slot);
    },
    [session],
  );

  const topicKey = TRAINING_TOPIC_PRESETS.find((p) => p.id === session.topicPreset)?.labelKey ?? null;
  const title =
    phase === 'forge' ? tx.title : profile?.name ? fmt(tx.trainTitle, { name: profile.name }) : tx.title;
  // The readiness jump inside the fields editor names a Hub slot; this surface
  // has one Hub and no deep link into it, so every slot lands in the same place.
  const openHubSlot = (_slot: TwinSlotId) => onOpenHub();

  // Every slot set, by readiness. Not `score >= 100`: the score also counts the
  // Brain, which no question on this table fills.
  const setupDone = session.stage === 'setup' && session.checklist.every((c) => c.status === 'set');
  const memoriesInSetup = session.stage === 'setup' && session.focus === 'memories' && !setupDone;

  if (phase === 'forge') {
    return (
      <div className="tx-felt flex-1 min-h-0 flex flex-col" data-testid="twin-experience-forge-phase">
        <div className="flex-shrink-0 flex items-center justify-between px-4 md:px-6 py-3 border-b border-primary/15">
          <h1 id={EXPERIENCE_TITLE_ID} className="typo-section-title text-foreground">
            {tx.title}
          </h1>
        </div>
        <ForgePhase onClose={onClose} onCreated={onCreated} />
      </div>
    );
  }

  return (
    <div className="tx-felt relative flex-1 min-h-0 flex flex-col" data-testid="twin-setup-page">
      <TableChrome
        title={title}
        stage={session.stage}
        stageTabs={
          <SegmentedTabs<SetupStage>
            tabs={[
              { id: 'setup', label: tx.table.stageSetup },
              { id: 'training', label: tx.table.stageTraining },
            ]}
            activeTab={session.stage}
            onTabChange={turn.chooseStage}
            variant="segment"
            size="sm"
            ariaLabel={tx.table.stageLabel}
            idPrefix={STAGE_TABS_ID}
          />
        }
        voice={voice}
        openDoor={door}
        onDoor={(next) => setDoor((live) => (live === next ? null : next))}
        studioWaiting={dock.waiting}
        onClose={onClose}
      />

      <TableProgress
        checklist={session.checklist}
        score={session.score}
        focus={session.focus}
        onFocus={session.focusOn}
      />

      <div
        className="flex-1 min-h-0 flex flex-col"
        data-testid="setup-body"
        {...segmentedTabPanelProps(STAGE_TABS_ID, session.stage)}
        role="tabpanel"
      >
        {session.generatorError && (
          <div className="flex-shrink-0 px-4 md:px-8 pt-4">
            <GuideDownNotice onRetry={session.redeal} onFields={() => setDoor('fields')} />
          </div>
        )}
        {setupDone ? (
          <div className="flex-1 min-h-0 overflow-y-auto px-4 md:px-8 py-6">
            <CompleteNotice
              name={profile?.name ?? tx.unnamed}
              onTrain={() => turn.chooseStage('training')}
              onClose={onClose}
            />
          </div>
        ) : memoriesInSetup ? (
          <div className="flex-1 min-h-0 overflow-y-auto px-4 md:px-8 py-6">
            <TrainingInvite onStart={() => turn.chooseStage('training')} />
          </div>
        ) : (
          <CardTable
            session={session}
            voice={voice}
            turn={turn}
            topicLabel={topicKey ? t.twin.training[topicKey] : null}
          />
        )}
      </div>

      <SheetLayer
        open={door === 'sheet'}
        onClose={() => setDoor(null)}
        session={session}
        onOpenFields={() => setDoor('fields')}
        onOpenHub={onOpenHub}
      />
      <DeckLayer
        open={door === 'deck'}
        onClose={() => setDoor(null)}
        topicPreset={session.topicPreset}
        coverage={coverage}
        rounds={momentum.sessions}
        onPick={turn.chooseTopic}
      />
      <VoiceLayer open={door === 'studio'} onClose={() => setDoor(null)} dock={dock} />
      <FieldsLayer
        open={door === 'fields'}
        onClose={() => setDoor(null)}
        session={session}
        onOpenHub={openHubSlot}
        onAskGuide={askGuide}
      />
    </div>
  );
}
