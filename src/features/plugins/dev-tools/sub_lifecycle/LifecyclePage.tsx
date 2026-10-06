/**
 * Lifecycle: the active project's development practice. The header names the
 * preset and version; the body is the ONE arrangement, `RailBelow`, over ONE
 * data model (`lifecycleView/useLifecycleView`).
 *
 * 2026-10-06, the owner's note: a node click no longer opens a drawer. The
 * selected step's state renders inline under the timeline, and the evidence is
 * a real `UnifiedTable` ledger rather than loose cards. The right-drawer
 * `StepDetailSheet` is gone: a modal that reopens on every node made walking
 * the journey impossible, which is the one thing the surface exists for.
 *
 * 2026-10-06, the same day, the owner's verdict on the round that followed:
 * "Keep Rail below variant and redo the prototype round, the goal was to
 * upgrade component visual design and visual quality, not to keep components
 * and experiment with the layout." So the two alternative ARRANGEMENTS are
 * gone, and the prototype axis is now a SKIN (`lifecycleView/skins`): three
 * visual positions over the same regions, the same information, the same
 * reading order and the same interaction. A skin has no field that can move a
 * region, which is how that stays true.
 *
 * Loading pattern v2: the header and the action row are permanent chrome; a
 * cold first load ghosts the timeline and the ledger ghosts itself (UnifiedTable
 * owns that contract from `isLoading`); a warm remount paints from the module
 * cache in useLifecycleSnapshot and revalidates; a failure shows an inline
 * banner and keeps any warm snapshot on screen.
 *
 * The skin switcher is dev-only and declared as a named constant rather than an
 * `import.meta.env.DEV` gate inside the JSX (a build-flag decision taken at the
 * point of rendering cannot be enumerated or reviewed; a named constant can be
 * grepped). It is session state, not Web Storage: it exists to pick a winner,
 * and a storage call for a prototype toggle would add a site the golden path
 * then has to route somewhere. The default is the look the owner kept.
 */
import { useState } from 'react';
import { GitBranch } from 'lucide-react';

import EmptyState from '@/features/shared/components/feedback/ScenarioEmptyState';
import { Segmented } from '@/features/shared/components/kit';
import { ContentBody, ContentBox, ContentHeader } from '@/features/shared/components/layout/ContentLayout';
import { useTranslation } from '@/i18n/useTranslation';

import { LifecycleProjectPicker } from './LifecycleProjectPicker';
import { LifecycleViewProvider } from './lifecycleView/context';
import { DEFAULT_SKIN_ID, LifecycleSkinProvider, SKINS, skinById, type SkinId } from './lifecycleView/skins';
import { useLifecycleView } from './lifecycleView/useLifecycleView';
import { RailBelow } from './lifecycleView/variants/RailBelow';

const SHOW_SKIN_SWITCHER = import.meta.env.DEV;

/** The switcher's own copy. A skin is a visual spec and holds no English (see
 *  `skins/types.ts`); these names are dev chrome and are deliberately not i18n
 *  keys, because the control does not ship. */
const SKIN_NAMES: Record<SkinId, string> = {
  wash: 'Wash',
  engraved: 'Engraved',
  plated: 'Plated',
};

const SKIN_OPTIONS = SKINS.map((s) => ({ v: s.id, label: SKIN_NAMES[s.id] }));

export default function LifecyclePage() {
  const { t } = useTranslation();
  const model = useLifecycleView();
  const [skinId, setSkinId] = useState<SkinId>(DEFAULT_SKIN_ID);

  return (
    <LifecycleViewProvider model={model}>
      <LifecycleSkinProvider skin={skinById(skinId)}>
        <ContentBox>
          <ContentHeader
            icon={<GitBranch className="w-5 h-5 text-violet-400" />}
            iconColor="violet"
            title={t.plugins.dev_tools.lifecycle_title}
            subtitle={model.subtitle}
            actions={
              <div className="flex items-center gap-2">
                {SHOW_SKIN_SWITCHER && (
                  <Segmented label="Lifecycle skin" value={skinId} onChange={setSkinId} options={SKIN_OPTIONS} />
                )}
                <LifecycleProjectPicker />
              </div>
            }
          />

          <ContentBody centered>
            {!model.projectId ? (
              <EmptyState icon={GitBranch} title={model.dl.lc_empty_title} subtitle={model.dl.lc_empty_subtitle} />
            ) : (
              <RailBelow />
            )}
          </ContentBody>
        </ContentBox>
      </LifecycleSkinProvider>
    </LifecycleViewProvider>
  );
}
