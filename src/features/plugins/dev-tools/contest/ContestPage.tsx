/**
 * Contest — the in-app home of the /contest method.
 *
 * Permanent chrome (title, the readiness strip for the focused project) over
 * the Arena: contests as races, one lane per seat. Arena won the prototype
 * round on 2026-09-24; the Contact Sheet and Pipeline Ledger shells were
 * deleted with it.
 */
import { Suspense } from 'react';
import { Trophy } from 'lucide-react';

import { ContentBody, ContentBox, ContentHeader } from '@/features/shared/components/layout/ContentLayout';
import { RouteChunkSkeleton } from '@/features/shared/components/layout/RouteChunkSkeleton';
import { useTranslation } from '@/i18n/useTranslation';
import { lazyRetry } from '@/lib/lazyRetry';
import { useSystemStore } from '@/stores/systemStore';

import { ReadinessStrip } from './components/ReadinessStrip';
import { useContestFocus } from './focus';

const Arena = lazyRetry(() => import('./arena'));

export default function ContestPage() {
  const { t } = useTranslation();
  const s = t.plugins.contest;
  const focusedProject = useContestFocus((st) => st.focused?.projectId ?? null);
  const activeProjectId = useSystemStore((st) => st.activeProjectId);

  return (
    <ContentBox data-testid="contest-page">
      <ContentHeader
        icon={<Trophy className="w-5 h-5 text-primary" />}
        iconColor="primary"
        title={s.page_title}
        subtitle={s.page_subtitle}
        fitWidth
      />
      <ContentBody>
        <div className="space-y-4">
          <ReadinessStrip projectId={focusedProject ?? activeProjectId ?? null} />
          <Suspense fallback={<RouteChunkSkeleton />}>
            <Arena />
          </Suspense>
        </div>
      </ContentBody>
    </ContentBox>
  );
}
