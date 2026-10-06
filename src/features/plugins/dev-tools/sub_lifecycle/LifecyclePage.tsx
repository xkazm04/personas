/**
 * Lifecycle: the active project's development practice. The header names the
 * preset and version; the body is one of the concepts in
 * `lifecycleView/variants`, every one of them over ONE data model
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
 * What stands in its place is a CONCEPT picker (`lifecycleView/variants/concepts`):
 * each entry is a different container for the same steps, the same evidence, the
 * same actions and the same keyboard model. It is dev-only, gated on a named
 * module constant rather than an `import.meta.env.DEV` test inside the JSX (a
 * build-flag decision taken at the point of rendering cannot be enumerated or
 * reviewed; a named constant can be grepped), and it is session state rather
 * than Web Storage: it exists to pick a winner, and a storage call for a
 * prototype toggle would add a site the golden path then has to route somewhere.
 * The default is the arrangement the owner kept, so nothing changes for a user.
 *
 * Loading pattern v2: the header and the action row are permanent chrome; a
 * cold first load ghosts the timeline and the ledger ghosts itself (UnifiedTable
 * owns that contract from `isLoading`); a warm remount paints from the module
 * cache in useLifecycleSnapshot and revalidates; a failure shows an inline
 * banner and keeps any warm snapshot on screen.
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
import { CONCEPTS, DEFAULT_CONCEPT_ID, conceptById } from './lifecycleView/variants/concepts';

const SHOW_CONCEPT_PICKER = import.meta.env.DEV;
const CONCEPT_OPTIONS = CONCEPTS.map((c) => ({ v: c.id, label: c.name }));

export default function LifecyclePage() {
  const { t } = useTranslation();
  const model = useLifecycleView();
  const [conceptId, setConceptId] = useState(DEFAULT_CONCEPT_ID);
  const { View } = conceptById(conceptId);

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
              {SHOW_CONCEPT_PICKER && (
                <Segmented
                  label="Lifecycle concept"
                  value={conceptId}
                  onChange={setConceptId}
                  options={CONCEPT_OPTIONS}
                />
              )}
              <LifecycleProjectPicker />
            </div>
          }
        />

        <ContentBody centered>
          {!model.projectId ? (
            <EmptyState icon={GitBranch} title={model.dl.lc_empty_title} subtitle={model.dl.lc_empty_subtitle} />
          ) : (
            <View />
          )}
        </ContentBody>
      </ContentBox>
    </LifecycleViewProvider>
  );
}
