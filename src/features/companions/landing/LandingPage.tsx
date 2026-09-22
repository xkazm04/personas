// Companions > Overview - the landing: three columns, one per companion.
//
// WP0 CONTRACT PLACEHOLDER: the path and the default export are frozen so the
// Companions router can lazy-import it. WP4 replaces the body with the port of
// the contest winner ("Heartlight"), whose whole idea is that the status lamp
// is the light each portrait already carries. The behaviour it must keep lives
// beside it and not in here: `useCompanionsStatus`, `landingStateOf`,
// `landingTarget`, `navigateToCompanions`.
import { Users } from 'lucide-react';

import { ContentBody, ContentBox, ContentHeader } from '@/features/shared/components/layout/ContentLayout';
import { useTranslation } from '@/i18n/useTranslation';

export default function LandingPage() {
  const { t } = useTranslation();

  return (
    <ContentBox>
      <ContentHeader
        icon={<Users className="w-4 h-4" />}
        title={t.companions.landing.title}
        subtitle={t.companions.landing.subtitle}
      />
      <ContentBody>
        <p className="typo-body-lg text-foreground">{t.companions.landing.subtitle}</p>
      </ContentBody>
    </ContentBox>
  );
}
