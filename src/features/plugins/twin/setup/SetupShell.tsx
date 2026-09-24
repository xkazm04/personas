/**
 * SetupShell — the page chrome the Setup body is rendered inside.
 *
 * The chrome is unconditional: title row, readiness strip and voice controls
 * paint on the first frame and never disappear while the flow works
 * (async-ui-states, law 1). Only the batch studio sits behind a Suspense
 * boundary, and its fallback is a calm header-shaped ghost.
 *
 * The body has TWO modes and the shell owns the switch: **Guide** (the Desk,
 * the default) and **Fields** (every slot typed directly). Fields was a
 * right-side drawer until 2026-09-16 — the wrong container for the longest text
 * in the product — and is page content now, which is why the mode lives here
 * rather than inside the Desk: it belongs to the session, as the voice controls
 * do, not to the surface asking the question.
 *
 * Both tab strips are rendered BESIDE the regions they swap, in this one file,
 * deliberately: a strip whose panel lives somewhere else is a control that
 * promises a relationship nothing declares (census `tabstrip-with-no-declared-panel`).
 *
 * The four-prototype switcher this file used to carry is gone: the Desk won,
 * and a switcher over one renderer is scaffolding pretending to be a choice.
 */

import { Suspense, useCallback, useState } from 'react';
import { lazyRetry } from '@/lib/lazyRetry';
import { GraduationCap, MessagesSquare, SlidersHorizontal } from 'lucide-react';
import { RouteChunkSkeleton } from '@/features/shared/components/layout/RouteChunkSkeleton';
import { SegmentedTabs } from '@/features/shared/components/layout/SegmentedTabs';
import { Button } from '@/features/shared/components/buttons';
import { useSystemStore } from '@/stores/systemStore';
import { useTranslation } from '@/i18n/useTranslation';
import type { TwinSlotId } from '../shared/twinStatus';
import type { SetupFocus, SetupSessionApi, SetupStage, SetupVoiceApi } from './setupContract';
import { rememberedSetupMode, rememberSetupMode, type SetupMode } from './setupMode';
import { SetupReadinessRow } from './SetupReadinessRow';
import { SetupGeneratorNotice } from './SetupGeneratorNotice';
import { SetupFieldsPage, type SetupFieldsJump } from './SetupFieldsPage';
import { SetupVoiceControls } from './SetupVoiceControls';
import { SetupDesk } from './SetupDesk';
import { TrainingMomentumBand } from '../sub_training/TrainingMomentumBand';

/**
 * The batch authoring board. It is a real capability with its own Rust
 * commands and no equivalent in the guided flow — the guide asks one question
 * at a time, the studio generates and curates a whole batch — so the v2
 * restructure keeps it and reaches it from here rather than reimplementing it.
 * Lazy, because most Setup sessions never open it.
 */
const TrainingStudio = lazyRetry(() => import('../sub_training/TrainingStudio'));

interface SetupShellProps {
  session: SetupSessionApi;
  voice: SetupVoiceApi;
  onOpenHub: (slot: TwinSlotId) => void;
}

export function SetupShell({ session, voice, onOpenHub }: SetupShellProps) {
  const { t } = useTranslation();
  const ts = t.twin.setup;
  const activeTwinId = useSystemStore((s) => s.activeTwinId);
  const [mode, setMode] = useState<SetupMode>(rememberedSetupMode);
  const [studioOpen, setStudioOpen] = useState(false);
  const [jump, setJump] = useState<SetupFieldsJump | null>(null);

  const chooseMode = useCallback((next: SetupMode) => {
    setMode(next);
    rememberSetupMode(next);
  }, []);

  /**
   * One strip, two meanings, and the difference is what the mode can do with a
   * slot. In Guide mode `focusOn` moves the conversation AND asks the new slot
   * a question; in Fields mode there is no question to replace, so the click
   * scrolls that slot's section in and marks it.
   */
  const focusSlot = useCallback(
    (slot: SetupFocus) => {
      if (mode === 'fields') {
        setJump({ slot, at: Date.now() });
        return;
      }
      session.focusOn(slot);
    },
    [mode, session],
  );

  /** A Fields band handing a slot back to the conversation that asks about it. */
  const askGuide = useCallback(
    (slot: SetupFocus) => {
      chooseMode('guide');
      session.focusOn(slot);
    },
    [chooseMode, session],
  );

  return (
    <div className="flex-1 min-h-0 flex flex-col" data-testid="twin-setup-page">
      {/* Title row — always present. */}
      <div className="flex-shrink-0 flex items-center gap-3 px-4 md:px-6 xl:px-8 py-3 border-b border-primary/10">
        <div className="flex-1 min-w-0">
          <h1 className="typo-section-title truncate">{ts.title}</h1>
          <p className="typo-caption truncate">{ts.subtitle}</p>
        </div>
        <div className="flex-shrink-0 w-[13.5rem] hidden md:block">
          <SegmentedTabs<SetupStage>
            tabs={[
              { id: 'setup', label: ts.stage.setup },
              { id: 'training', label: ts.stage.training },
            ]}
            activeTab={session.stage}
            onTabChange={session.setStage}
            variant="segment"
            size="sm"
            ariaLabel={ts.stage.label}
            idPrefix="setup-stage"
          />
        </div>
        <SetupVoiceControls voice={voice} />
        {session.stage === 'training' && (
          <Button
            variant={studioOpen ? 'accent' : 'secondary'}
            tone="agent"
            size="sm"
            aria-pressed={studioOpen}
            onClick={() => setStudioOpen((open) => !open)}
            data-testid="setup-open-studio"
            icon={<GraduationCap className="w-3.5 h-3.5" />}
          >
            {studioOpen ? ts.studio.close : ts.studio.open}
          </Button>
        )}
        {/* The mode switch. `setup-open-fields` rides on the Fields tab: it is
            the same affordance the button used to be, so the id the E2E suite
            drives does not move with the redesign. */}
        <div className="flex-shrink-0 w-[11.5rem]">
          <SegmentedTabs<SetupMode>
            tabs={[
              {
                id: 'guide',
                label: (
                  <span className="flex items-center gap-1.5">
                    <MessagesSquare className="w-3.5 h-3.5" aria-hidden />
                    {ts.mode.guide}
                  </span>
                ),
              },
              {
                id: 'fields',
                label: (
                  <span className="flex items-center gap-1.5">
                    <SlidersHorizontal className="w-3.5 h-3.5" aria-hidden />
                    {ts.openFields}
                  </span>
                ),
                testId: 'setup-open-fields',
              },
            ]}
            activeTab={mode}
            onTabChange={chooseMode}
            variant="segment"
            size="sm"
            ariaLabel={ts.mode.label}
            idPrefix="setup-mode"
          />
        </div>
      </div>

      <SetupReadinessRow
        checklist={session.checklist}
        score={session.score}
        focus={session.focus}
        onFocus={focusSlot}
      />

      {/* The training stage's baseline: sessions finished and per-topic
          coverage, before the user has to invent a subject. */}
      {session.stage === 'training' && (
        <TrainingMomentumBand
          twinId={activeTwinId}
          topic={session.topic}
          onPickTopic={session.setTopic}
          refreshToken={session.history.length}
        />
      )}

      {session.generatorError && (
        <SetupGeneratorNotice onOpenFields={() => chooseMode('fields')} />
      )}

      <div
        className="flex-1 min-h-0 flex flex-col"
        data-testid="setup-body"
        role="tabpanel"
        id={`setup-stage-panel-${session.stage}`}
        aria-labelledby={`setup-stage-tab-${session.stage}`}
      >
        {/* The swapped region, declared as the mode switch's own panel. */}
        <div
          className="flex-1 min-h-0 flex flex-col"
          role="tabpanel"
          id={`setup-mode-panel-${mode}`}
          aria-labelledby={`setup-mode-tab-${mode}`}
        >
          <Suspense fallback={<RouteChunkSkeleton showActions={false} />}>
            {studioOpen ? (
              <TrainingStudio onExit={() => setStudioOpen(false)} />
            ) : mode === 'fields' ? (
              /* The page opens on what is actually STORED, and `session.values`
                 is the only source that carries the `tone:<channel>` slots —
                 the profile row in the store has no field for them, so reading
                 it left every tone field blank. */
              <SetupFieldsPage
                session={session}
                values={session.values}
                jump={jump}
                onOpenHub={onOpenHub}
                onAskGuide={askGuide}
              />
            ) : (
              <SetupDesk session={session} voice={voice} onOpenHub={onOpenHub} />
            )}
          </Suspense>
        </div>
      </div>
    </div>
  );
}

export default SetupShell;
