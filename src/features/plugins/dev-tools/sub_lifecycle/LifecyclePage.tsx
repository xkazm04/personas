/**
 * Lifecycle: the active project's development practice. The header names the
 * preset and version; the body is `RailBelow` over ONE data model
 * (`lifecycleView/useLifecycleView`).
 *
 * 2026-10-06, the owner's note: a node click no longer opens a drawer. The
 * selected step's state renders inline under the timeline, and the evidence is
 * a real `UnifiedTable` ledger rather than loose cards. The right-drawer
 * `StepDetailSheet` is gone: a modal that reopened on every node made walking
 * the journey impossible, which is the one thing the surface exists for.
 *
 * 2026-10-06, the same day, the owner's verdict on the round that followed:
 * "Keep wash with note again to change colors of borders or background is not
 * prototyping nor component redesign, this prototype became invalid again." So
 * the SKIN mechanism is deleted. The look the owner kept is now ordinary classes
 * at the sites that draw them (`lifecycleView/blocks/*`,
 * `lifecycleView/variants/RailBelow`), there is no skin registry, no skin
 * provider and no skin switcher, and `journeyStyles` carries one state mark
 * instead of three fills behind a lookup. A variant on this surface is a
 * different CONTAINER for the same material, which a utility map cannot express.
 *
 * Loading pattern v2: the header and the action row are permanent chrome; a
 * cold first load ghosts the timeline and the ledger ghosts itself (UnifiedTable
 * owns that contract from `isLoading`); a warm remount paints from the module
 * cache in useLifecycleSnapshot and revalidates; a failure shows an inline
 * banner and keeps any warm snapshot on screen.
 */
import { GitBranch } from 'lucide-react';

import EmptyState from '@/features/shared/components/feedback/ScenarioEmptyState';
import { ContentBody, ContentBox, ContentHeader } from '@/features/shared/components/layout/ContentLayout';
import { useTranslation } from '@/i18n/useTranslation';

import { LifecycleProjectPicker } from './LifecycleProjectPicker';
import { LifecycleViewProvider } from './lifecycleView/context';
import { useLifecycleView } from './lifecycleView/useLifecycleView';
import { RailBelow } from './lifecycleView/variants/RailBelow';

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
          actions={<LifecycleProjectPicker />}
        />

        <ContentBody centered>
          {!model.projectId ? (
            <EmptyState icon={GitBranch} title={model.dl.lc_empty_title} subtitle={model.dl.lc_empty_subtitle} />
          ) : (
            <RailBelow />
          )}
        </ContentBody>
      </ContentBox>
    </LifecycleViewProvider>
  );
}
