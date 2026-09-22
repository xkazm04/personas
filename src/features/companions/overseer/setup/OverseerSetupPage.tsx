// Overseer > Setup - the switch and the watched roster.
//
// WP0 CONTRACT PLACEHOLDER: the path and the default export are frozen so the
// Companions router can lazy-import it; WP3 replaces the body with the enable
// toggle (refused, with the prerequisite stated, while no agent is starred)
// and the watched-agents list.
import { Eye } from 'lucide-react';

import { ContentBody, ContentBox, ContentHeader } from '@/features/shared/components/layout/ContentLayout';
import { useTranslation } from '@/i18n/useTranslation';

export default function OverseerSetupPage() {
  const { t } = useTranslation();

  return (
    <ContentBox>
      <ContentHeader icon={<Eye className="w-4 h-4" />} title={t.companions.nav.group_overseer} subtitle={t.companions.identity.overseer_tagline} />
      <ContentBody>
        <p className="typo-body-lg text-foreground">{t.companions.setup.overseer_enable_desc}</p>
      </ContentBody>
    </ContentBox>
  );
}
