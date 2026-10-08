/**
 * Lifecycle: the active project's development practice. The header names the
 * preset and version; the body is `lifecycleView/LifecycleBody`, over ONE data
 * model (`lifecycleView/useLifecycleView`).
 *
 * Two layers in one page (spark lifecycle-health, 2026-10-08). Layer 1 is the
 * whole practice as the COLLAR RAIL - the owner's pick of the WP3 round - with
 * every step's measured verdict and metrics. Pressing a step replaces it, in
 * place, with that step's Layer-2 screen: its metrics drawn large around its
 * icon and a preset for its kind of step (gate / tests / docs / generic). Esc
 * comes back. Not a drawer and not a route: the owner's 2026-10-06 note that a
 * modal reopened on every node made walking the journey impossible still
 * holds, so Layer 2 walks too (Left / Right).
 *
 * Earlier rounds on this surface, closed by the owner: a skin registry and a
 * concept registry (both deleted), the Tactile rail with its docked state
 * panel and evidence ledger (retired here; the ledger lives on each step's
 * screen now), and the three Layer-1 directions (orbit and lanes deleted).
 *
 * Loading pattern v2: the header and the action row are permanent chrome; a
 * cold first load ghosts the rail; a warm remount paints from the module
 * cache in useLifecycleSnapshot and revalidates; a failure shows an inline
 * banner and keeps any warm snapshot on screen.
 */
import { GitBranch } from 'lucide-react';

import EmptyState from '@/features/shared/components/feedback/ScenarioEmptyState';
import { ContentBody, ContentBox, ContentHeader } from '@/features/shared/components/layout/ContentLayout';
import { useTranslation } from '@/i18n/useTranslation';

import { LifecycleProjectPicker } from './LifecycleProjectPicker';
import { OverseerControls } from './lifecycleView/blocks/OverseerControls';
import { LifecycleViewProvider } from './lifecycleView/context';
import { LifecycleBody } from './lifecycleView/LifecycleBody';
import { useLifecycleView } from './lifecycleView/useLifecycleView';

export default function LifecyclePage() {
  const { t } = useTranslation();
  const model = useLifecycleView();

  return (
    <LifecycleViewProvider model={model}>
      <ContentBox>
        <ContentHeader
          icon={<GitBranch className="w-5 h-5 text-violet-400" />}
          iconColor="violet"
          title={t.plugins.dev_tools.lifecycle_title}
          subtitle={model.subtitle}
          actions={
            <div className="flex items-start gap-2">
              <LifecycleProjectPicker />
              {model.projectId && model.snapshot && (
                <OverseerControls projectId={model.projectId} watched={model.snapshot.watched} goal={model.snapshot.goal} />
              )}
            </div>
          }
        />

        <ContentBody centered>
          {!model.projectId ? (
            <EmptyState icon={GitBranch} title={model.dl.lc_empty_title} subtitle={model.dl.lc_empty_subtitle} />
          ) : (
            <LifecycleBody />
          )}
        </ContentBody>
      </ContentBox>
    </LifecycleViewProvider>
  );
}
