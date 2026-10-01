/**
 * The experience's two phases, one surface: FORGE a twin, then play it at the
 * TABLE — with no page, tab or dialog change between them.
 *
 * It owns the session (one engine, never two), the turn, and which door is
 * open. Only one layer is ever open: every door shares a single value, so
 * "one act at a time" is structural rather than remembered.
 *
 * A `train` request opens straight on the table for the active twin; with no
 * twin active there is nothing to train, so it opens on the forge instead. A
 * request that names a `door` opens with that layer already up.
 *
 * The table is played ON the blueprint (spark twin-portable-blueprint): the
 * selected variant fills the play area in stage mode and the hand floats over
 * it. The blueprint replaced the felt and the readiness strip; readiness is one
 * of the things it draws.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { SegmentedTabs, segmentedTabPanelProps } from '@/features/shared/components/layout/SegmentedTabs';
import { useTranslation } from '@/i18n/useTranslation';
import { useSystemStore } from '@/stores/systemStore';
import type { SetupFocus, SetupStage } from '../setup/setupContract';
import { useSetupSession } from '../setup/useSetupSession';
import { useSetupVoice } from '../setup/useSetupVoice';
import { scoreTopicCoverage, type TopicCoverage } from '../sub_training/topicCoverage';
import type { TwinSlotId } from '../shared/twinStatus';
import { BlueprintStage } from '../blueprint/BlueprintStage';
import { SECTION_DOOR } from '../blueprint/sectionDoors';
import { StageHand } from '../blueprint/StageHand';
import { useStageBlueprint } from '../blueprint/useStageBlueprint';
import type { ExperienceRequest } from './launcher';
import { EXPERIENCE_TITLE_ID } from './experienceIds';
import { ForgePhase } from './forge/ForgePhase';
import { TableChrome, type ExperienceDoor } from './table/TableChrome';
import { useTurn } from './table/useTurn';
import { DeckLayer } from './layers/DeckLayer';
import { FieldsLayer } from './layers/FieldsLayer';
import { PlanLayer } from './layers/PlanLayer';
import { SheetLayer } from './layers/SheetLayer';
import { VoiceLayer } from './layers/VoiceLayer';
import { useVoiceDock } from './layers/useVoiceDock';
import './experience.css';

/** The stage strip's id prefix, shared by the strip and the panel it controls. */
const STAGE_TABS_ID = 'twin-experience-stage';

/** Every topic thin, until the blueprint's first read lands. */
const NO_COVERAGE: TopicCoverage[] = scoreTopicCoverage([]);

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
  const stage = useStageBlueprint(activeTwinId, session, turn.verdict);
  // The deck's per-topic counts are the blueprint's: one read, not two.
  const coverage = useMemo<TopicCoverage[]>(
    () => stage.model?.training.topics.map((tp) => ({ id: tp.id, count: tp.approved, tier: tp.tier })) ?? NO_COVERAGE,
    [stage.model],
  );

  const [phase, setPhase] = useState<'forge' | 'play'>(() =>
    request.mode === 'create' || !activeTwinId ? 'forge' : 'play',
  );
  const [door, setDoor] = useState<ExperienceDoor | null>(() =>
    request.mode === 'train' ? (request.door ?? null) : null,
  );

  const { chooseStage } = turn;
  useEffect(() => {
    if (request.mode === 'train' && request.stage) chooseStage(request.stage);
    // Once, for the stage the entry point asked for. One steer (or none, when
    // the stored session is already there) — never a second LLM turn.
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

  const title =
    phase === 'forge' ? tx.title : profile?.name ? fmt(tx.trainTitle, { name: profile.name }) : tx.title;
  // The readiness jump inside the fields editor names a Hub slot; this surface
  // has one Hub and no deep link into it, so every slot lands in the same place.
  const openHubSlot = (_slot: TwinSlotId) => onOpenHub();

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
    <div className="relative flex-1 min-h-0 flex flex-col" data-testid="twin-setup-page">
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

      <div
        className="relative flex-1 min-h-0 flex flex-col"
        data-testid="setup-body"
        {...segmentedTabPanelProps(STAGE_TABS_ID, session.stage)}
        role="tabpanel"
      >
        <BlueprintStage
          model={stage.model}
          delta={stage.delta}
          working={stage.working}
          reduced={stage.reduced}
          onSection={(section) => setDoor(SECTION_DOOR[section])}
        />
        <StageHand
          session={session}
          voice={voice}
          turn={turn}
          holding={stage.holding}
          name={profile?.name ?? tx.unnamed}
          onClose={onClose}
          onFields={() => setDoor('fields')}
        />
      </div>

      <PlanLayer open={door === 'plan'} onClose={() => setDoor(null)} session={session} />
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
        answered={stage.model?.training.answered ?? null}
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
