/**
 * Act two: the lane.
 *
 * One question, up to three answers, one field, one line of keys — and the
 * doors in the rail that lead everywhere else. `useSetupSession` is the only
 * engine: readiness stays the one completion authority, and nothing is written
 * until a person keeps it.
 *
 * The rule this file enforces is that the lane never GROWS. Everything a
 * competing surface would put in a column — what the twin knows, what to train
 * on, the voice studio, every field — is a layer that opens over it and closes
 * again, so the centre of the screen is the same three things from the first
 * turn to the last. `Lane` is that centre; `StageLayers` is everything else.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { motion } from 'framer-motion';
import { useReducedMotion } from '@/hooks/utility/interaction/useMotion';
import { SegmentedTabs, segmentedTabPanelProps } from '@/features/shared/components/layout/SegmentedTabs';
import { useTranslation } from '@/i18n/useTranslation';
import { useSystemStore } from '@/stores/systemStore';
import type { SetupFocus, SetupProposal, SetupStage } from '../../../setup/setupContract';
import { useSetupSession } from '../../../setup/useSetupSession';
import { useSetupVoice } from '../../../setup/useSetupVoice';
import { deriveDeskTrail } from '../../../setup/desk/trailModel';
import { useDeskProposals } from '../../../setup/desk/useDeskProposals';
import { useTrainingMomentum } from '../../../sub_training/useTrainingMomentum';
import { TRAINING_TOPIC_PRESETS } from '../../../sub_training/useTrainingSession';
import { useCoverage } from '../layers/useCoverage';
import { useVoiceDock } from '../layers/useVoiceDock';
import { Lane } from './Lane';
import { StageLayers } from './StageLayers';
import { StageRail, type MirrorDoor } from './StageRail';
import { laneKeyHandler } from './keys';
import { useTurn } from './useTurn';

/** The strip's id prefix, shared by the strip and the panel it controls. */
const STAGE_TABS_ID = 'mr-stage';

interface StageProps {
  initialStage?: SetupStage;
  /** A twin made in this sitting: the first question greets it. */
  fresh: boolean;
  onClose: () => void;
  onOpenHub: () => void;
}

export function Stage({ initialStage, fresh, onClose, onOpenHub }: StageProps) {
  const { t, tx, language } = useTranslation();
  const mr = t.twin.experience_mirror;
  const reduced = useReducedMotion();
  const session = useSetupSession();
  const voice = useSetupVoice(session);
  const turn = useTurn(session);
  const laneRef = useRef<HTMLDivElement>(null);

  const activeTwinId = useSystemStore((s) => s.activeTwinId);
  const pronouns = useSystemStore(
    (s) => s.twinProfiles.find((p) => p.id === activeTwinId)?.pronouns ?? null,
  );
  const dock = useVoiceDock(activeTwinId, session.toneChannels);
  // Only the training deck reads these; the setup stage does not pay for them.
  const training = session.stage === 'training';
  const coverage = useCoverage(training ? activeTwinId : null, session.history.length);
  const momentum = useTrainingMomentum(training ? activeTwinId : null, session.history.length);

  const [door, setDoor] = useState<MirrorDoor | null>(null);
  const [fieldsOpen, setFieldsOpen] = useState(false);
  /** The one line the lane says when something was just written down. */
  const [whisper, setWhisper] = useState<{ text: string; at: number } | null>(null);

  const cards = useMemo(
    () => (session.answerMode === 'write' ? [] : session.suggestions.slice(0, 3)),
    [session.answerMode, session.suggestions],
  );
  const proposals = useDeskProposals(session, turn.setDraft);
  const trail = useMemo(
    () => deriveDeskTrail(session.history, session.question),
    [session.history, session.question],
  );
  const topicKey = TRAINING_TOPIC_PRESETS.find((p) => p.id === session.topicPreset)?.labelKey ?? null;

  const { chooseStage } = turn;
  useEffect(() => {
    if (initialStage) chooseStage(initialStage);
    // Once, for the stage the entry point asked for.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => {
    laneRef.current?.focus();
  }, []);

  // The opening line exists only where it is true: the first turn of a sitting,
  // naming the slots still open, joined the way the language joins a list
  // (never with a hard-coded English comma).
  const open = session.checklist
    .filter((c) => c.status !== 'set')
    .map((c) => t.twin.setup.checklist[c.id]);
  const list = new Intl.ListFormat(language, { type: 'conjunction' }).format(open);
  const twinName = session.values.name || mr.rail.unnamed;
  const greeting =
    trail.isOpening && session.stage === 'setup' && open.length > 0
      ? fresh
        ? tx(mr.ask.greetingFresh, { name: twinName, items: list })
        : tx(mr.ask.greeting, { items: list })
      : null;

  const onKept = useCallback(
    (proposal: SetupProposal) => {
      setWhisper({
        text: tx(mr.whisper.kept, { field: t.twin.setup.proposal.kind[proposal.kind] }),
        at: Date.now(),
      });
    },
    [tx, mr.whisper.kept, t.twin.setup.proposal.kind],
  );

  const edit = useCallback(
    (index: number) => {
      const card = cards[index];
      if (!card) return;
      turn.setDraft(card.text);
      laneRef.current?.querySelector<HTMLTextAreaElement>('[data-testid="mr-reply-input"]')?.focus();
    },
    [cards, turn],
  );

  const askGuide = useCallback((slot: SetupFocus) => session.focusOn(slot), [session]);

  const onKeyDown = laneKeyHandler({
    count: cards.length,
    picked: turn.picked,
    setPicked: turn.setPicked,
    play: (i) => {
      const card = cards[i];
      if (card) turn.play(card.text);
    },
    edit,
    skip: turn.skip,
  });

  return (
    <motion.div
      className="absolute inset-0 flex flex-col overflow-hidden"
      initial={reduced ? { opacity: 0 } : { opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0, transition: { duration: 0.34, ease: [0.22, 1, 0.36, 1] } }}
      data-testid="mr-stage"
    >
      <StageRail
        name={twinName}
        pronouns={pronouns}
        checklist={session.checklist}
        score={session.score}
        stage={session.stage}
        // The strip is rendered HERE, beside the region it swaps, and that
        // region declares itself its panel below — a strip whose panel lives
        // in another file advertises a relationship nothing states.
        stageTabs={
          <SegmentedTabs<SetupStage>
            tabs={[
              { id: 'setup', label: t.twin.setup.stage.setup },
              { id: 'training', label: t.twin.setup.stage.training },
            ]}
            activeTab={session.stage}
            onTabChange={turn.chooseStage}
            variant="segment"
            size="sm"
            ariaLabel={t.twin.setup.stage.label}
            idPrefix={STAGE_TABS_ID}
          />
        }
        openDoor={door}
        onDoor={(next) => setDoor((live) => (live === next ? null : next))}
        voiceWaiting={dock.waiting}
        onClose={onClose}
      />

      <div
        ref={laneRef}
        tabIndex={-1}
        onKeyDown={onKeyDown}
        data-testid="mr-lane"
        // The helper owns the id scheme so the strip's `aria-controls` cannot
        // dangle. `role="tabpanel"` is then written again, literally, because
        // census `tabstrip-with-no-declared-panel` keys on that exact string
        // and cannot see it arrive through a spread — the same belt-and-braces
        // the contest scaffold itself uses (twinExperienceVariant.tsx).
        {...segmentedTabPanelProps(STAGE_TABS_ID, session.stage)}
        role="tabpanel"
        className="flex-1 min-h-0 overflow-y-auto outline-none"
      >
        {/* `min-h-full` + `justify-center` centres a short turn and lets a long
            one grow the box instead of overflowing past its own top, which is
            what a bare `justify-center` on a scroller does. */}
        <div className="min-h-full flex flex-col justify-center px-6 py-6">
          <div className="mx-auto w-full max-w-[var(--mr-lane)] flex flex-col gap-4">
            <Lane
              session={session}
              voice={voice}
              turn={turn}
              cards={cards}
              proposals={proposals}
              twinName={twinName}
              topicLabel={topicKey ? t.twin.training[topicKey] : null}
              greeting={greeting}
              whisper={whisper}
              onKept={onKept}
              onOpenFields={() => setFieldsOpen(true)}
              onClose={onClose}
            />
          </div>
        </div>
      </div>

      <StageLayers
        session={session}
        door={door}
        onDoor={setDoor}
        fieldsOpen={fieldsOpen}
        onFields={setFieldsOpen}
        dock={dock}
        coverage={coverage}
        rounds={momentum.sessions}
        onPickTopic={turn.chooseTopic}
        onOpenHub={onOpenHub}
        onAskGuide={askGuide}
      />
    </motion.div>
  );
}

export default Stage;
