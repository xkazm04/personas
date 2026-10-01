/**
 * The Twin Detail page, under the `setup` tab id (spark
 * twin-portable-blueprint).
 *
 * Layer one is the twin's blueprint, drawn by the variant the switcher picked
 * from what the app already holds. L2 is a section the variant zooms into
 * (`focus`, owned here); L3 is the read-only drawer with a section's full
 * detail. Escape walks back one layer at a time: the drawer first (it is a
 * BaseModal, higher on the key ladder), then the zoom.
 *
 * Arriving here NEVER opens the overlay and never opens a setup session: the
 * blueprint reads `setupGet` (a pure read) and store slices, so a visit cannot
 * start a paid plan. Only the header's two CTAs (and "Edit in setup" in the
 * drawer) open the experience.
 */
import { Suspense, useCallback, useEffect, useState } from 'react';
import { ScanFace } from 'lucide-react';

import { ContentBody, ContentBox } from '@/features/shared/components/layout/ContentLayout';
import { SegmentedTabs, segmentedTabPanelProps } from '@/features/shared/components/layout/SegmentedTabs';
import { useReducedMotion } from '@/hooks/utility/interaction/useMotion';
import { useTranslation } from '@/i18n/useTranslation';
import { ROUTE_DECISION_PRIORITY, useAppKeyboard } from '@/lib/keyboard/AppKeyboardProvider';
import { useSystemStore } from '@/stores/systemStore';

import { TwinEmptyState } from '../TwinEmptyState';
import { BLUEPRINT_VARIANT_IDS, type BlueprintVariantId, type SectionId } from './blueprintContract';
import { useBlueprintVariant } from './blueprintVariant';
import { BlueprintGhost } from './BlueprintGhost';
import { DetailHeader } from './DetailHeader';
import { SectionDetailDrawer, type DetailTarget } from './SectionDetailDrawer';
import { useDetailRefresh } from './useDetailRefresh';
import { useTwinBlueprint } from './useTwinBlueprint';
import { BLUEPRINT_VARIANTS } from './variantRegistry';

/** The switcher's id prefix, shared by the strip and the panel it controls. */
const VARIANT_TABS_ID = 'twin-blueprint-variant';

export default function TwinDetailPage() {
  const { t } = useTranslation();
  const tb = t.twin.blueprint;
  const twinId = useSystemStore((s) => s.activeTwinId);
  const profile = useSystemStore((s) => s.twinProfiles.find((p) => p.id === s.activeTwinId) ?? null);
  const refreshKey = useDetailRefresh(twinId);
  const { model, sources } = useTwinBlueprint(twinId, { refreshKey });
  const [variant, setVariant] = useBlueprintVariant();
  const [focus, setFocus] = useState<SectionId | null>(null);
  const [detail, setDetail] = useState<DetailTarget | null>(null);
  const reduced = useReducedMotion();

  // A different twin is a different drawing: start it at the overview.
  useEffect(() => {
    setFocus(null);
    setDetail(null);
  }, [twinId]);

  // L2 back to L1. Off while the drawer is up: Escape is the drawer's first.
  useAppKeyboard(
    (event) => {
      if (event.key !== 'Escape') return false;
      setFocus(null);
      return true;
    },
    { enabled: focus !== null && detail === null, priority: ROUTE_DECISION_PRIORITY },
  );

  const openDetail = useCallback((section: SectionId, itemKey?: string) => setDetail({ section, itemKey }), []);
  const closeDetail = useCallback(() => setDetail(null), []);

  if (!twinId || !profile) return <TwinEmptyState icon={ScanFace} title={t.twin.detail.tabLabel} />;

  const Variant = BLUEPRINT_VARIANTS[variant];

  return (
    <ContentBox data-testid="twin-experience-launch">
      <DetailHeader
        profile={profile}
        samplesOpen={model?.samples.open ?? null}
        switcher={
          <SegmentedTabs<BlueprintVariantId>
            tabs={BLUEPRINT_VARIANT_IDS.map((id) => ({ id, label: tb.variants[id], testId: `twin-blueprint-variant-${id}` }))}
            activeTab={variant}
            onTabChange={(next) => {
              setVariant(next);
              setFocus(null);
            }}
            variant="segment"
            size="sm"
            ariaLabel={tb.variants.label}
            idPrefix={VARIANT_TABS_ID}
          />
        }
      />
      <ContentBody flex noPadding>
        <div
          className="flex-1 min-h-0 flex flex-col"
          data-testid="twin-detail-blueprint"
          data-variant={variant}
          {...segmentedTabPanelProps(VARIANT_TABS_ID, variant)}
          role="tabpanel"
        >
          {model ? (
            <Suspense fallback={<BlueprintGhost />}>
              <Variant
                model={model}
                mode="detail"
                focus={focus}
                onFocus={setFocus}
                onOpenDetail={openDetail}
                delta={null}
                working={false}
                reduced={reduced}
              />
            </Suspense>
          ) : (
            <BlueprintGhost />
          )}
        </div>
      </ContentBody>
      {model && sources && <SectionDetailDrawer target={detail} model={model} sources={sources} onClose={closeDetail} />}
    </ContentBox>
  );
}
