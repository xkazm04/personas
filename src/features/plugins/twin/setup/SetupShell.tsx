/**
 * SetupShell — the page chrome the Setup Desk is rendered inside.
 *
 * The chrome is unconditional: title row, readiness strip and voice controls
 * paint on the first frame and never disappear while the flow works
 * (async-ui-states, law 1). Only the batch studio sits behind a Suspense
 * boundary, and its fallback is a calm header-shaped ghost.
 *
 * The drawer and the voice controls live here, not in the Desk, because they
 * belong to the session rather than to the surface asking the question.
 *
 * The four-prototype switcher this file used to carry is gone: the Desk won,
 * and a switcher over one renderer is scaffolding pretending to be a choice.
 */

import { Suspense, useState } from 'react';
import { lazyRetry } from '@/lib/lazyRetry';
import { GraduationCap, SlidersHorizontal, TriangleAlert } from 'lucide-react';
import { RouteChunkSkeleton } from '@/features/shared/components/layout/RouteChunkSkeleton';
import { SegmentedTabs } from '@/features/shared/components/layout/SegmentedTabs';
import { Button } from '@/features/shared/components/buttons';
import { useTranslation } from '@/i18n/useTranslation';
import type { TwinSlotId } from '../shared/twinStatus';
import type { SetupSessionApi, SetupStage, SetupVoiceApi } from './setupContract';
import { SetupReadinessRow } from './SetupReadinessRow';
import { SetupFieldsDrawer } from './SetupFieldsDrawer';
import { SetupVoiceControls } from './SetupVoiceControls';
import { SetupDesk } from './SetupDesk';

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
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [studioOpen, setStudioOpen] = useState(false);

  return (
    <div className="flex-1 min-h-0 flex flex-col" data-testid="twin-setup-page">
      {/* Title row — always present. */}
      <div className="flex-shrink-0 flex items-center gap-3 px-4 md:px-6 xl:px-8 py-3 border-b border-primary/10">
        <div className="flex-1 min-w-0">
          <h1 className="typo-section-title text-foreground truncate">{ts.title}</h1>
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
            accentColor="violet"
            size="sm"
            aria-pressed={studioOpen}
            onClick={() => setStudioOpen((open) => !open)}
            data-testid="setup-open-studio"
            icon={<GraduationCap className="w-3.5 h-3.5" />}
          >
            {studioOpen ? ts.studio.close : ts.studio.open}
          </Button>
        )}
        <Button
          variant="secondary"
          size="sm"
          onClick={() => setDrawerOpen(true)}
          data-testid="setup-open-fields"
          icon={<SlidersHorizontal className="w-3.5 h-3.5" />}
        >
          {ts.openFields}
        </Button>
      </div>

      <SetupReadinessRow
        checklist={session.checklist}
        score={session.score}
        focus={session.focus}
        onFocus={session.focusOn}
      />

      {/* A generator failure is a calm notice that points at the drawer. It
          never reads as completion and never blocks typing. */}
      {session.generatorError && (
        <div
          className="flex-shrink-0 flex items-center gap-2 px-4 md:px-6 xl:px-8 py-2 border-b border-status-warning/25 bg-status-warning/8"
          data-testid="setup-generator-error"
        >
          <TriangleAlert className="w-4 h-4 text-status-warning flex-shrink-0" />
          <span className="typo-caption min-w-0 truncate">{ts.generatorError.title}</span>
          <Button variant="ghost" size="xs" className="ml-auto" onClick={() => setDrawerOpen(true)}>
            {ts.generatorError.action}
          </Button>
        </div>
      )}

      <div
        className="flex-1 min-h-0 flex flex-col"
        data-testid="setup-body"
        role="tabpanel"
        id={`setup-stage-panel-${session.stage}`}
        aria-labelledby={`setup-stage-tab-${session.stage}`}
      >
        <Suspense fallback={<RouteChunkSkeleton showActions={false} />}>
          {studioOpen
            ? <TrainingStudio onExit={() => setStudioOpen(false)} />
            : <SetupDesk session={session} voice={voice} onOpenHub={onOpenHub} />}
        </Suspense>
      </div>

      {/* The drawer opens on what is actually stored, and `session.values` is the
          only source that carries the `tone:<channel>` slots — the profile row in
          the store has no field for them, so reading it left every tone field
          blank. */}
      <SetupFieldsDrawer
        isOpen={drawerOpen}
        onClose={() => setDrawerOpen(false)}
        session={session}
        values={session.values}
      />
    </div>
  );
}

export default SetupShell;
