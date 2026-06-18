// Goal acceptance as a summoned full-screen overlay (the Persona-Monitor
// pattern), opened from the title-bar badge. The acceptance queue used to be a
// Goals sub-view ("Accept"); that sidebar item was removed — goals are still
// acceptable from the Board (Your-turn lane + the detail drawer), and this
// overlay is the dedicated, full-size review surface.
import { BadgeCheck } from 'lucide-react';

import { FullScreenOverlay } from '@/features/shared/components/layout/FullScreenOverlay';
import { ContentBox, ContentHeader, ContentBody } from '@/features/shared/components/layout/ContentLayout';
import { useTranslation } from '@/i18n/useTranslation';

import { GoalAcceptanceView } from './GoalAcceptanceView';

export function GoalAcceptanceOverlay({ onClose }: { onClose: () => void }) {
  const { t } = useTranslation();
  const dl = t.plugins.dev_lifecycle;
  return (
    <FullScreenOverlay onClose={onClose} testId="goal-acceptance-overlay">
      <ContentBox>
        <ContentHeader
          icon={<BadgeCheck className="w-5 h-5 text-teal-300" />}
          title={dl.accept_overlay_title}
          subtitle={dl.accept_overlay_subtitle}
        />
        <ContentBody>
          <GoalAcceptanceView />
        </ContentBody>
      </ContentBox>
    </FullScreenOverlay>
  );
}
