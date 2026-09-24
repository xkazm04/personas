/**
 * Overlay header: title, stage, fields/table switch, voice, close.
 */

import { X } from 'lucide-react';
import { Button } from '@/features/shared/components/buttons';
import { SegmentedTabs } from '@/features/shared/components/layout/SegmentedTabs';
import { useTranslation } from '@/i18n/useTranslation';
import { SetupVoiceControls } from '../../../setup/SetupVoiceControls';
import type { SetupSessionApi, SetupStage, SetupVoiceApi } from '../../../setup/setupContract';

export type TableView = 'guide' | 'fields';

interface TableChromeProps {
  title: string;
  session: SetupSessionApi;
  voice: SetupVoiceApi;
  view: TableView;
  onView: (view: TableView) => void;
  onClose: () => void;
}

export function TableChrome({ title, session, voice, view, onView, onClose }: TableChromeProps) {
  const { t } = useTranslation();
  const xg = t.twin.experience_grok;

  return (
    <div className="flex-shrink-0 flex items-center gap-3 px-4 md:px-6 py-3 border-b border-primary/15">
      <div className="flex-1 min-w-0">
        <h1 id="twin-experience-title" className="typo-section-title truncate">
          {title}
        </h1>
        <p className="typo-caption text-primary truncate">{xg.forge.hint}</p>
      </div>
      <div className="flex-shrink-0 w-[13.5rem] hidden md:block">
        <SegmentedTabs<SetupStage>
          tabs={[
            { id: 'setup', label: xg.table.stageSetup },
            { id: 'training', label: xg.table.stageTraining },
          ]}
          activeTab={session.stage}
          onTabChange={session.setStage}
          variant="segment"
          size="sm"
          ariaLabel={xg.table.stageLabel}
          idPrefix="setup-stage"
        />
      </div>
      <SetupVoiceControls voice={voice} />
      <div className="flex-shrink-0 w-[11.5rem]">
        <SegmentedTabs<TableView>
          tabs={[
            { id: 'guide', label: xg.table.openGuide },
            { id: 'fields', label: xg.table.openFields, testId: 'setup-open-fields' },
          ]}
          activeTab={view}
          onTabChange={onView}
          variant="segment"
          size="sm"
          ariaLabel={xg.table.viewLabel}
          idPrefix="setup-mode"
        />
      </div>
      <Button
        variant="ghost"
        size="icon-sm"
        onClick={onClose}
        aria-label={xg.close}
        data-testid="twin-experience-close"
        icon={<X className="w-4 h-4" />}
      />
    </div>
  );
}

export default TableChrome;
