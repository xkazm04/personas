/**
 * Lifecycle: the active project's development practice, over ONE data model
 * (`lifecycleView/useLifecycleView`).
 *
 * The FRAME (Lifecycle excellence wave 1, 2026-10-08): the header names the
 * PROJECT, with one line under it for the practice and how fresh its
 * measurement is against the base branch (`frame/HeaderSubtitle`), and one
 * action cluster on its own row (`frame/HeaderToolbar`): picker, Measure, the
 * Overseer hand-off, Ask Athena, and Install when a binding is missing. The
 * header and its cluster are permanent chrome: they paint at their final size
 * before the snapshot lands, disabled where they need it.
 *
 * Two layers in one body (`lifecycleView/LifecycleBody`). Layer 1 is the whole
 * practice as the collar rail; pressing a step replaces it, in place, with
 * that step's Layer-2 screen (a lazily loaded chunk, warmed on intent). Esc
 * comes back. Not a drawer and not a route: the owner's 2026-10-06 note that a
 * modal reopened on every node made walking the journey impossible still
 * holds, so Layer 2 walks too (Left / Right).
 *
 * A running Measure is one session for the whole page (`measure/measureSession`):
 * the header's Measure control turns into its live progress and its subtitle
 * says the time left, Layer 1 shows the Measure panel in the status band's
 * slot, and Gate and Tests hold their verdict until the last run lands.
 *
 * Loading pattern v2: a cold first load ghosts Layer 1 in its real geometry
 * under the permanent header; a warm remount paints from the module cache in
 * useLifecycleSnapshot and revalidates; a failure shows an inline banner and
 * keeps any warm snapshot on screen.
 */
import { GitBranch } from 'lucide-react';

import EmptyState from '@/features/shared/components/feedback/ScenarioEmptyState';
import { ContentBody, ContentBox, ContentHeader } from '@/features/shared/components/layout/ContentLayout';
import { useTranslation } from '@/i18n/useTranslation';

import { LifecycleViewProvider } from './lifecycleView/context';
import { HeaderSubtitle } from './lifecycleView/frame/HeaderSubtitle';
import { HeaderToolbar } from './lifecycleView/frame/HeaderToolbar';
import { LifecycleBody } from './lifecycleView/LifecycleBody';
import { MeasureSessionProvider } from './lifecycleView/measure/measureSession';
import { GLYPH } from './lifecycleView/system/scales';
import { useLifecycleView } from './lifecycleView/useLifecycleView';

export default function LifecyclePage() {
  const { t } = useTranslation();
  const model = useLifecycleView();

  return (
    <LifecycleViewProvider model={model}>
      <MeasureSessionProvider>
        <ContentBox>
          <ContentHeader
            compact
            icon={<GitBranch className={`${GLYPH.md} text-primary`} />}
            iconColor="primary"
            title={model.projectName ?? t.plugins.dev_tools.lifecycle_title}
            subtitle={model.projectId ? <HeaderSubtitle /> : undefined}
          >
            <HeaderToolbar />
          </ContentHeader>

          <ContentBody centered>
            {!model.projectId ? (
              <EmptyState icon={GitBranch} title={model.dl.lc_empty_title} subtitle={model.dl.lc_empty_subtitle} />
            ) : (
              <LifecycleBody />
            )}
          </ContentBody>
        </ContentBox>
      </MeasureSessionProvider>
    </LifecycleViewProvider>
  );
}
