/**
 * The frame the training surface is played inside: one line of chrome, then
 * the two nested panels it swaps.
 *
 * The header is deliberately NOT a toolbar. Where you are — the twin's name
 * and the readiness meter — is one cluster on the left; the two strips that
 * change what is being asked (stage, view) hold the middle; and the things
 * reached for rarely (the style deck, voice, the way out) are icons after a
 * divider, so they cannot read as loudly as a tab. The subtitle that used to
 * sit under the name was chrome describing chrome, and is gone.
 *
 * Both tab strips live HERE, in the same file as the regions they swap
 * (census `tabstrip-with-no-declared-panel`): a strip whose panel is declared
 * elsewhere promises a relationship nothing states. That is why the panels
 * came with the header when this was lifted out of `TrainingTable`, and why
 * `children` — the surface for the current mode — arrives as a prop.
 */

import type { ReactNode } from 'react';
import { GraduationCap, LayoutGrid, Palette, SlidersHorizontal } from 'lucide-react';
import { Button } from '@/features/shared/components/buttons';
import { Tooltip } from '@/features/shared/components/display/Tooltip';
import { SegmentedTabs } from '@/features/shared/components/layout/SegmentedTabs';
import { useTranslation } from '@/i18n/useTranslation';
import type { SetupSessionApi, SetupStage, SetupVoiceApi } from '../../../setup/setupContract';
import { SetupVoiceControls } from '../../../setup/SetupVoiceControls';
import { EXPERIENCE_TITLE_ID } from '../experienceIds';
import { ExperienceClose } from '../ExperienceClose';
import { ScoreMeter } from './ScoreMeter';

export type TrainingMode = 'table' | 'fields' | 'studio';

interface TrainingFrameProps {
  twinName: string;
  session: SetupSessionApi;
  voice: SetupVoiceApi;
  mode: TrainingMode;
  onModeChange: (mode: TrainingMode) => void;
  onStageChange: (stage: SetupStage) => void;
  styleOpen: boolean;
  onToggleStyle: () => void;
  onClose: () => void;
  /** The surface the two strips selected, rendered inside the panels. */
  children: ReactNode;
}

export function TrainingFrame({
  twinName,
  session,
  voice,
  mode,
  onModeChange,
  onStageChange,
  styleOpen,
  onToggleStyle,
  onClose,
  children,
}: TrainingFrameProps) {
  const { t } = useTranslation();
  const xo = t.twin.experience_opus;

  return (
    <div className="flex-1 min-h-0 flex flex-col" data-testid="xo-training">
      <header className="flex-shrink-0 flex flex-wrap items-center gap-x-4 gap-y-2 px-6 py-2.5 border-b border-primary/10 bg-background/50">
        <div className="min-w-0 flex items-center gap-3">
          <h2 id={EXPERIENCE_TITLE_ID} className="typo-title-lg text-foreground truncate">
            {twinName}
          </h2>
          <ScoreMeter checklist={session.checklist} score={session.score} />
        </div>
        <div className="ml-auto flex flex-wrap items-center gap-2">
          <div className="w-[11rem]">
            <SegmentedTabs<SetupStage>
              tabs={[
                { id: 'setup', label: xo.stage.setup },
                { id: 'training', label: xo.stage.training },
              ]}
              activeTab={session.stage}
              onTabChange={onStageChange}
              variant="segment"
              size="sm"
              ariaLabel={xo.stage.label}
              idPrefix="xo-stage"
            />
          </div>
          <div className="w-[13rem]">
            <SegmentedTabs<TrainingMode>
              tabs={[
                { id: 'table', label: <ModeLabel icon={<LayoutGrid className="w-3.5 h-3.5" />} text={xo.mode.table} /> },
                { id: 'fields', label: <ModeLabel icon={<SlidersHorizontal className="w-3.5 h-3.5" />} text={xo.mode.fields} />, testId: 'xo-mode-fields' },
                ...(session.stage === 'training'
                  ? [{ id: 'studio' as const, label: <ModeLabel icon={<GraduationCap className="w-3.5 h-3.5" />} text={xo.mode.studio} /> }]
                  : []),
              ]}
              activeTab={mode}
              onTabChange={onModeChange}
              variant="segment"
              size="sm"
              ariaLabel={xo.mode.label}
              idPrefix="xo-mode"
            />
          </div>
          <span aria-hidden className="hidden sm:block w-px h-5 bg-primary/15" />
          <Tooltip content={xo.style.title}>
            <Button
              variant={styleOpen ? 'accent' : 'ghost'}
              accentColor="violet"
              size="icon-sm"
              aria-pressed={styleOpen}
              aria-label={xo.style.title}
              onClick={onToggleStyle}
              icon={<Palette className="w-4 h-4" />}
              data-testid="xo-open-style"
            />
          </Tooltip>
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
          {children}
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

export default TrainingFrame;
