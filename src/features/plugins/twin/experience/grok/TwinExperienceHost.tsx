/**
 * Phase router inside the overlay. Create starts on the forge; after the twin
 * exists we deal the table without leaving the overlay. Train skips the forge.
 */

import { useCallback, useState } from 'react';
import { X } from 'lucide-react';
import { useSystemStore } from '@/stores/systemStore';
import { Button } from '@/features/shared/components/buttons';
import { useTranslation } from '@/i18n/useTranslation';
import type { TwinSlotId } from '../../shared/twinStatus';
import type { SetupSessionApi, SetupVoiceApi } from '../../setup/setupContract';
import { SetupFieldsPage, type SetupFieldsJump } from '../../setup/SetupFieldsPage';
import { SetupGeneratorNotice } from '../../setup/SetupGeneratorNotice';
import { TrainingMomentumBand } from '../../sub_training/TrainingMomentumBand';
import { ForgePhase } from './forge/ForgePhase';
import { CardTable } from './table/CardTable';
import { TableChrome, type TableView } from './table/TableChrome';
import { TableProgress } from './table/TableProgress';

export type ExperienceMode = 'create' | 'train';

interface TwinExperienceHostProps {
  mode: ExperienceMode;
  session: SetupSessionApi;
  voice: SetupVoiceApi;
  onClose: () => void;
  onOpenHub: (slot: TwinSlotId) => void;
}

export function TwinExperienceHost({
  mode,
  session,
  voice,
  onClose,
  onOpenHub,
}: TwinExperienceHostProps) {
  const { t, tx } = useTranslation();
  const xg = t.twin.experience_grok;
  const activeTwinId = useSystemStore((s) => s.activeTwinId);
  const twinProfiles = useSystemStore((s) => s.twinProfiles);
  const profile = activeTwinId ? twinProfiles.find((p) => p.id === activeTwinId) : null;

  const [phase, setPhase] = useState<'forge' | 'play'>(mode === 'create' ? 'forge' : 'play');
  const [view, setView] = useState<TableView>('guide');
  const [jump, setJump] = useState<SetupFieldsJump | null>(null);

  const onCreated = useCallback(({ withStyle }: { withStyle: boolean }) => {
    setView(withStyle ? 'fields' : 'guide');
    setPhase('play');
  }, []);

  const focusSlot = useCallback(
    (slot: Parameters<SetupSessionApi['focusOn']>[0]) => {
      if (view === 'fields') {
        setJump({ slot, at: Date.now() });
        return;
      }
      session.focusOn(slot);
    },
    [view, session],
  );

  const askGuide = useCallback(
    (slot: Parameters<SetupSessionApi['focusOn']>[0]) => {
      setView('guide');
      session.focusOn(slot);
    },
    [session],
  );

  const title =
    phase === 'forge'
      ? xg.title
      : profile?.name
        ? tx(xg.trainTitle, { name: profile.name })
        : xg.title;

  return (
    <div className="flex-1 min-h-0 flex flex-col bg-background" data-testid="twin-setup-page">
      {phase === 'forge' ? (
        <>
          <div className="flex-shrink-0 flex items-center justify-between px-4 md:px-6 py-3 border-b border-primary/15">
            <h1 id="twin-experience-title" className="typo-section-title">
              {xg.title}
            </h1>
            <Button
              variant="ghost"
              size="icon-sm"
              onClick={onClose}
              aria-label={xg.close}
              data-testid="twin-experience-close"
              icon={<X className="w-4 h-4" />}
            />
          </div>
          <ForgePhase onClose={onClose} onCreated={onCreated} />
        </>
      ) : (
        <>
          <TableChrome
            title={title}
            session={session}
            voice={voice}
            view={view}
            onView={setView}
            onClose={onClose}
          />
          <TableProgress
            checklist={session.checklist}
            score={session.score}
            focus={session.focus}
            onFocus={focusSlot}
          />
          {session.stage === 'training' && (
            <TrainingMomentumBand
              twinId={activeTwinId}
              topic={session.topic}
              onPickTopic={session.setTopic}
              refreshToken={session.history.length}
            />
          )}
          {session.generatorError && (
            <SetupGeneratorNotice onOpenFields={() => setView('fields')} />
          )}
          <div
            className="flex-1 min-h-0 flex flex-col"
            data-testid="setup-body"
            role="tabpanel"
            id={`setup-stage-panel-${session.stage}`}
            aria-labelledby={`setup-stage-tab-${session.stage}`}
          >
            <div
              className="flex-1 min-h-0 flex flex-col"
              role="tabpanel"
              id={`setup-mode-panel-${view}`}
              aria-labelledby={`setup-mode-tab-${view}`}
            >
              {view === 'fields' ? (
                <SetupFieldsPage
                  session={session}
                  values={session.values}
                  jump={jump}
                  onOpenHub={onOpenHub}
                  onAskGuide={askGuide}
                />
              ) : (
                <CardTable session={session} voice={voice} onOpenHub={onOpenHub} />
              )}
            </div>
          </div>
        </>
      )}
    </div>
  );
}

export default TwinExperienceHost;
