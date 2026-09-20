// Council - the descent from the registry galaxy, through the bench of
// councils waiting on a person, to one council's round table and its gate.
//
// The visual contract is `docs/design/council-reference/index.html`: every
// build of this page is compared against it. This shell owns the header and
// the stage; the galaxy layer mounts inside, and WP8's bench takes the
// `bench` slot below the field without ever hiding it.
import { Scale } from 'lucide-react';

import { ContentBody, ContentBox, ContentHeader } from '@/features/shared/components/layout/ContentLayout';
import { useTranslation } from '@/i18n/useTranslation';

import { GalaxyStage } from './galaxy/GalaxyStage';

export default function CouncilPage() {
  const { t } = useTranslation();
  return (
    <ContentBox data-testid="council-page">
      <ContentHeader
        icon={<Scale className="w-5 h-5 text-violet-400" />}
        iconColor="violet"
        title={t.sidebar.council}
        fitWidth
      />
      <ContentBody>
        <div data-testid="council-stage" className="relative h-full min-h-0">
          <GalaxyStage />
        </div>
      </ContentBody>
    </ContentBox>
  );
}
