/**
 * Contest — the in-app home of the /contest method.
 *
 * Permanent chrome (title, the shell switch, the readiness strip for the
 * focused project) over three prototype shells that render the same engine
 * (hooks + shared components) through different metaphors. The operator
 * picks one after living with all three; until then the switch is in-memory
 * only (`focus.ts`), never persisted.
 *
 * The shell names are proper names of the prototypes, not UI copy, so they
 * stay out of i18n until one of them wins and is consolidated.
 */
import { Suspense } from 'react';
import { Trophy } from 'lucide-react';

import { ContentBody, ContentBox, ContentHeader } from '@/features/shared/components/layout/ContentLayout';
import { RouteChunkSkeleton } from '@/features/shared/components/layout/RouteChunkSkeleton';
import {
  SegmentedTabs,
  segmentedTabPanelProps,
  type SegmentedTab,
} from '@/features/shared/components/layout/SegmentedTabs';
import { useTranslation } from '@/i18n/useTranslation';
import { lazyRetry } from '@/lib/lazyRetry';
import { useSystemStore } from '@/stores/systemStore';

import { ReadinessStrip } from './components/ReadinessStrip';
import { useContestFocus, type ContestSurface } from './focus';

const ArenaShell = lazyRetry(() => import('./shells/arena'));
const ContactSheetShell = lazyRetry(() => import('./shells/contact'));
const PipelineLedgerShell = lazyRetry(() => import('./shells/ledger'));

const SURFACE_TABS: SegmentedTab<ContestSurface>[] = [
  { id: 'arena', label: 'Arena', testId: 'contest-surface-arena' },
  { id: 'contact', label: 'Contact Sheet', testId: 'contest-surface-contact' },
  { id: 'ledger', label: 'Ledger', testId: 'contest-surface-ledger' },
];

const TAB_PREFIX = 'contest-surface';

export default function ContestPage() {
  const { t } = useTranslation();
  const s = t.plugins.contest;
  const surface = useContestFocus((st) => st.surface);
  const setSurface = useContestFocus((st) => st.setSurface);
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
        actions={
          <SegmentedTabs
            tabs={SURFACE_TABS}
            activeTab={surface}
            onTabChange={setSurface}
            idPrefix={TAB_PREFIX}
            ariaLabel={s.surface_switch_label}
            fullWidth={false}
            size="sm"
          />
        }
      />
      <ContentBody>
        <div className="space-y-4">
          <ReadinessStrip projectId={focusedProject ?? activeProjectId ?? null} />
          <div
            role="tabpanel"
            id={segmentedTabPanelProps(TAB_PREFIX, surface).id}
            aria-labelledby={segmentedTabPanelProps(TAB_PREFIX, surface)['aria-labelledby']}
          >
            <Suspense fallback={<RouteChunkSkeleton />}>
              {surface === 'arena' && <ArenaShell />}
              {surface === 'contact' && <ContactSheetShell />}
              {surface === 'ledger' && <PipelineLedgerShell />}
            </Suspense>
          </div>
        </div>
      </ContentBody>
    </ContentBox>
  );
}
