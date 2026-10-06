/**
 * Lifecycle: the active project's development practice. The header names the
 * preset and version; the body is one of three prototype layouts over ONE data
 * model (`lifecycleView/useLifecycleView`), so a variant is layout and styling
 * only.
 *
 * 2026-10-06, the owner's note: a node click no longer opens a drawer. The
 * selected step's state renders inline under the timeline, and the evidence is
 * a real `UnifiedTable` ledger rather than loose cards. The right-drawer
 * `StepDetailSheet` is gone: a modal that reopens on every node made walking
 * the journey impossible, which is the one thing the surface exists for.
 *
 * Loading pattern v2: the header and the action row are permanent chrome; a
 * cold first load ghosts the timeline and the ledger ghosts itself (UnifiedTable
 * owns that contract from `isLoading`); a warm remount paints from the module
 * cache in useLifecycleSnapshot and revalidates; a failure shows an inline
 * banner and keeps any warm snapshot on screen.
 *
 * The variant switcher is dev-only and declared as a named constant rather than
 * an `import.meta.env.DEV` gate inside the JSX, and it is session-scoped: it
 * exists to pick a winner, and a Web Storage call for a prototype toggle would
 * add a storage site the golden path then has to route somewhere.
 */
import { useState } from 'react';
import { GitBranch } from 'lucide-react';

import EmptyState from '@/features/shared/components/feedback/ScenarioEmptyState';
import { Segmented } from '@/features/shared/components/kit';
import { ContentBody, ContentBox, ContentHeader } from '@/features/shared/components/layout/ContentLayout';
import { useTranslation } from '@/i18n/useTranslation';

import { LifecycleProjectPicker } from './LifecycleProjectPicker';
import { LifecycleViewProvider } from './lifecycleView/context';
import { useLifecycleView } from './lifecycleView/useLifecycleView';
import { LedgerFirst } from './lifecycleView/variants/LedgerFirst';
import { RailBelow } from './lifecycleView/variants/RailBelow';
import { StepperBeside } from './lifecycleView/variants/StepperBeside';

/** See the header: a build-flag decision taken at the point of rendering cannot
 *  be enumerated or reviewed; a named constant can be grepped. */
const SHOW_LAYOUT_SWITCHER = import.meta.env.DEV;

type LifecycleLayout = 'rail' | 'stepper' | 'ledger';

const LAYOUTS: Array<{ v: LifecycleLayout; label: string }> = [
  { v: 'rail', label: 'Rail below' },
  { v: 'stepper', label: 'Stepper beside' },
  { v: 'ledger', label: 'Ledger first' },
];

/** The baseline: the surface as it shipped, minus the drawer. */
const DEFAULT_LAYOUT: LifecycleLayout = 'rail';

export default function LifecyclePage() {
  const { t } = useTranslation();
  const model = useLifecycleView();
  const [layout, setLayout] = useState<LifecycleLayout>(DEFAULT_LAYOUT);

  return (
    <LifecycleViewProvider model={model}>
      <ContentBox>
        <ContentHeader
          icon={<GitBranch className="w-5 h-5 text-violet-400" />}
          iconColor="violet"
          title={t.plugins.dev_tools.lifecycle_title}
          subtitle={model.subtitle}
          actions={
            <div className="flex items-center gap-2">
              {SHOW_LAYOUT_SWITCHER && (
                <Segmented label="Lifecycle layout" value={layout} onChange={setLayout} options={LAYOUTS} />
              )}
              <LifecycleProjectPicker />
            </div>
          }
        />

        <ContentBody centered>
          {!model.projectId ? (
            <EmptyState icon={GitBranch} title={model.dl.lc_empty_title} subtitle={model.dl.lc_empty_subtitle} />
          ) : layout === 'stepper' ? (
            <StepperBeside />
          ) : layout === 'ledger' ? (
            <LedgerFirst />
          ) : (
            <RailBelow />
          )}
        </ContentBody>
      </ContentBox>
    </LifecycleViewProvider>
  );
}
