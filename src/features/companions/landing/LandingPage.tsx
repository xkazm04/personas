// Companions > Overview - the landing: three columns, one per companion.
//
// The thin wrapper. Everything it knows comes from beside it:
// `useCompanionsStatus` reads the category, `landingStateOf` derives what a
// column draws, `landingTarget` decides where it opens and
// `navigateToCompanions` is the one way in. The look is `CompanionsTriptych`,
// a port of the contest winner "Heartlight" - the status lamp is the light
// each portrait already carries.
import { Users } from 'lucide-react';
import { useCallback } from 'react';

import { ContentBody, ContentBox, ContentHeader } from '@/features/shared/components/layout/ContentLayout';
import { useTranslation } from '@/i18n/useTranslation';

import { CompanionsTriptych, type CompanionsTriptychProps } from './CompanionsTriptych';
import type { CompanionColumnView } from './landingModel';
import { navigateToCompanions } from '../navigation';
import { useCompanionsStatus } from '../status/useCompanionsStatus';

/**
 * The page's chrome around the triptych, with its data injected. Exported so
 * the shot harness photographs the INTEGRATED page - the same `ContentBox` /
 * `ContentHeader` / `ContentBody` the app renders - rather than a component
 * in isolation, which is the only version whose widths are real.
 */
export function LandingSurface(props: CompanionsTriptychProps) {
  const { t } = useTranslation();

  return (
    <ContentBox>
      <ContentHeader
        icon={<Users className="w-4 h-4" />}
        title={t.companions.landing.title}
        subtitle={t.companions.landing.subtitle}
        actions={
          <span className="typo-caption hide-on-touch">{t.companions.landing.shortcut_hint}</span>
        }
      />
      <ContentBody flex>
        {/* Full-bleed: the triptych owns the whole body and scrolls nothing. */}
        <div className="flex-1 min-h-0 flex">
          <CompanionsTriptych {...props} />
        </div>
      </ContentBody>
    </ContentBox>
  );
}

export default function LandingPage() {
  const { companions, loading, error, refresh } = useCompanionsStatus();

  const open = useCallback((view: CompanionColumnView) => {
    navigateToCompanions(view.target);
  }, []);

  return (
    <LandingSurface
      companions={companions}
      loading={loading}
      error={error}
      onOpen={open}
      onRetry={refresh}
    />
  );
}
