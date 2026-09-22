// Curator > Setup - the switch and the mapped registries.
//
// WP0 CONTRACT PLACEHOLDER: the path and the default export are frozen so the
// Companions router can lazy-import it; WP3 replaces the body with the enable
// toggle (refused, with the prerequisite stated, while no workspace maps a
// registry) and the mapped-registry list.
import { BookOpen } from 'lucide-react';

import { ContentBody, ContentBox, ContentHeader } from '@/features/shared/components/layout/ContentLayout';
import { useTranslation } from '@/i18n/useTranslation';

export default function CuratorSetupPage() {
  const { t } = useTranslation();

  return (
    <ContentBox>
      <ContentHeader icon={<BookOpen className="w-4 h-4" />} title={t.companions.nav.group_curator} subtitle={t.companions.identity.curator_tagline} />
      <ContentBody>
        <p className="typo-body-lg text-foreground">{t.companions.setup.curator_enable_desc}</p>
      </ContentBody>
    </ContentBox>
  );
}
