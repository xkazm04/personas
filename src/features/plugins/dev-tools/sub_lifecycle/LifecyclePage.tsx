/**
 * Lifecycle: the active project's development practice. The header names the
 * preset and version; the body is `lifecycleView/RailBelow`, over ONE data
 * model (`lifecycleView/useLifecycleView`).
 *
 * 2026-10-06, the owner's note: a node click no longer opens a drawer. The
 * selected step's state renders inline under the timeline, and the evidence is
 * a real `UnifiedTable` ledger rather than loose cards. The right-drawer
 * `StepDetailSheet` is gone: a modal that reopened on every node made walking
 * the journey impossible, which is the one thing the surface exists for.
 *
 * 2026-10-06, the same day, TWO prototype rounds ran on this surface and the
 * owner closed both. The first varied the look by SKIN - "to change colors of
 * borders or background is not prototyping nor component redesign" - and the
 * second offered three rival containers for the same material, which he also
 * declined. Neither mechanism survives: there is no skin registry and no
 * concept registry, no provider, no picker and no dev gate. The body is one
 * component named directly, and the look the owner kept is ordinary classes at
 * the sites that draw them (`lifecycleView/blocks/*`, `lifecycleView/RailBelow`),
 * with `journeyStyles` carrying one state mark instead of three fills behind a
 * lookup.
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
import { RailBelow } from './lifecycleView/RailBelow';
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
