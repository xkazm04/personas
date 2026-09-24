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
 * Both tab strips live in this file, beside the regions they swap (census
 * `tabstrip-with-no-declared-panel`): a strip whose panel is declared
 * elsewhere promises a relationship nothing states.
 */

import { Suspense, useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { GraduationCap, LayoutGrid, Palette, SlidersHorizontal } from 'lucide-react';
import { lazyRetry } from '@/lib/lazyRetry';
import { Button } from '@/features/shared/components/buttons';
import { SegmentedTabs } from '@/features/shared/components/layout/SegmentedTabs';
import { RouteChunkSkeleton } from '@/features/shared/components/layout/RouteChunkSkeleton';
import { useTranslation } from '@/i18n/useTranslation';
import { useSystemStore } from '@/stores/systemStore';
import type { TwinSlotId } from '../../../shared/twinStatus';
import type { SetupFocus, SetupStage } from '../../../setup/setupContract';
import { useSetupSession } from '../../../setup/useSetupSession';
import { useSetupVoice } from '../../../setup/useSetupVoice';
import { SetupFieldsPage } from '../../../setup/SetupFieldsPage';
import { SetupVoiceControls } from '../../../setup/SetupVoiceControls';
import { useTrainingMomentum } from '../../../sub_training/useTrainingMomentum';
import { EXPERIENCE_TITLE_ID } from '../experienceIds';
import { ExperienceClose } from '../ExperienceClose';
import { TablePlay } from './TablePlay';
import { ScoreMeter } from './ScoreMeter';
import { StyleSheet } from './StyleSheet';
import { useStyleDock } from './useStyleDock';
import { useTopicCoverage } from './useTopicCoverage';
import type { TopicCard } from './topicDeck';

const TrainingStudio = lazyRetry(() => import('../../../sub_training/TrainingStudio'));

type Mode = 'table' | 'fields' | 'studio';

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
    <div className="flex-1 min-h-0 flex flex-col" data-testid="xo-training">
      <header className="flex-shrink-0 flex flex-wrap items-center gap-x-5 gap-y-2 px-6 py-3 border-b border-primary/10 bg-background/50">
        <div className="min-w-0">
          <h2 id={EXPERIENCE_TITLE_ID} className="typo-heading-lg text-foreground truncate">
            {twinName}
          </h2>
          <p className="typo-caption">{xo.table.subtitle}</p>
        </div>
        <ScoreMeter checklist={session.checklist} score={session.score} />
        <div className="ml-auto flex flex-wrap items-center gap-3">
          <div className="w-[14rem]">
            <SegmentedTabs<SetupStage>
              tabs={[
                { id: 'setup', label: xo.stage.setup },
                { id: 'training', label: xo.stage.training },
              ]}
              activeTab={session.stage}
              onTabChange={chooseStage}
              variant="segment"
              size="sm"
              ariaLabel={xo.stage.label}
              idPrefix="xo-stage"
            />
          </div>
          <div className="w-[15rem]">
            <SegmentedTabs<Mode>
              tabs={[
                { id: 'table', label: <ModeLabel icon={<LayoutGrid className="w-3.5 h-3.5" />} text={xo.mode.table} /> },
                { id: 'fields', label: <ModeLabel icon={<SlidersHorizontal className="w-3.5 h-3.5" />} text={xo.mode.fields} />, testId: 'xo-mode-fields' },
                ...(session.stage === 'training'
                  ? [{ id: 'studio' as const, label: <ModeLabel icon={<GraduationCap className="w-3.5 h-3.5" />} text={xo.mode.studio} /> }]
                  : []),
              ]}
              activeTab={mode}
              onTabChange={setMode}
              variant="segment"
              size="sm"
              ariaLabel={xo.mode.label}
              idPrefix="xo-mode"
            />
          </div>
          <Button
            variant={styleOpen ? 'accent' : 'secondary'}
            tone="agent"
            size="sm"
            aria-pressed={styleOpen}
            onClick={() => setStyleOpen((open) => !open)}
            icon={<Palette className="w-3.5 h-3.5" />}
            data-testid="xo-open-style"
          >
            {xo.style.title}
          </Button>
          <SetupVoiceControls voice={voice} />
          <ExperienceClose onClose={onClose} />
        </div>
      </header>

      {/* Two nested panels, one per strip: the stage decides what is asked,
          the mode decides how it is shown. */}
      <div
        className="flex-1 min-h-0 flex flex-col"
        role="tabpanel"
        id={`xo-stage-panel-${session.stage}`}
        aria-labelledby={`xo-stage-tab-${session.stage}`}
      >
        <div
          className="relative flex-1 min-h-0 flex flex-col"
          role="tabpanel"
          id={`xo-mode-panel-${mode}`}
          aria-labelledby={`xo-mode-tab-${mode}`}
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
        </div>
      </div>
    </div>
  );
}

function ModeLabel({ icon, text }: { icon: ReactNode; text: string }) {
  return (
    <span className="flex items-center gap-1.5">
      <span aria-hidden>{icon}</span>
      {text}
    </span>
  );
}

export default TrainingTable;
