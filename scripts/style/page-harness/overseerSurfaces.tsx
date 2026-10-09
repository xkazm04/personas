/**
 * Lifecycle excellence wave 9: Companions > Overseer > Reviews (the integrated
 * DirectorCoachingTab, its own ContentBox shell), on the synthetic tapes in
 * `lifecycleOverseerTapes.mjs`.
 *
 *   companions/overseer/empty-scope  no agent in the coaching scope; the Watched
 *                                    pipelines render under the empty state
 *   companions/overseer/scorecard    two agents in scope; the Watched pipelines
 *                                    at the foot of the scorecard (below the fold)
 *   companions/overseer/watched      the Watched pipelines section alone, in the
 *                                    page's content column, so its cards are in
 *                                    the shot at both sizes
 */
import { ContentBody, ContentBox } from '@/features/shared/components/layout/ContentLayout';
import { useSystemStore } from '@/stores/systemStore';
import type { HarnessModule } from './registry';

function prepare() {
  useSystemStore.setState({ sidebarSection: 'companions', companionsPage: 'overseer:reviews' });
}

const page = () => import('@/features/companions/overseer/DirectorCoachingTab');

async function watchedOnly() {
  const { WatchedPipelines } = await import('@/features/companions/overseer/components/WatchedPipelines');
  return {
    default: function WatchedHarness() {
      return (
        <ContentBox>
          <ContentBody>
            <WatchedPipelines />
          </ContentBody>
        </ContentBox>
      );
    },
  };
}

export const OVERSEER_MODULES: Record<string, HarnessModule> = {
  'companions/overseer/empty-scope': { load: page, prepare },
  'companions/overseer/scorecard': { load: page, prepare },
  'companions/overseer/watched': { load: watchedOnly, prepare },
};
