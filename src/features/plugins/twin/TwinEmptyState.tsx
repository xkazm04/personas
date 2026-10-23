import { Plus } from 'lucide-react';
import { getBrandTokens } from '@/lib/connectors/brandTokens';
import { useSystemStore } from '@/stores/systemStore';
import { ContentBox, ContentHeader, ContentBody } from '@/features/shared/components/layout/ContentLayout';
import EmptyState from '@/features/shared/components/feedback/ScenarioEmptyState';
import { useTranslation } from '@/i18n/useTranslation';
import type { LucideIcon } from 'lucide-react';
import { TwinGlyph } from './TwinGlyph';

/**
 * Shared empty state for Twin sub-tabs when no twin is active.
 * Shows the tab icon + title and a CTA to navigate to the Profiles tab.
 */
export function TwinEmptyState({ icon: Icon, title }: { icon: LucideIcon; title: string }) {
  const t = useTranslation().t.twin;
  const setTwinTab = useSystemStore((s) => s.setTwinTab);
  const brand = getBrandTokens('twin');

  return (
    <ContentBox>
      <ContentHeader
        icon={<Icon className="w-5 h-5 text-violet-400" />}
        iconColor="violet"
        title={title}
        subtitle={t.emptyState.subtitle}
      />
      <ContentBody centered>
        {/* The twin brand glyph is bespoke (not in the icon -> art map), so it
            stays as the badge; the type ramp and CTA come from the primitive. */}
        <EmptyState
          icon={TwinGlyph}
          iconColor={brand.icon}
          iconContainerClassName={`${brand.badgeBg} ${brand.badgeBorder}`}
          size="lg"
          title={t.emptyState.noTwinSelected}
          description={t.emptyState.createFirstTwin}
          action={{ label: t.selector.createTwin, icon: Plus, onClick: () => setTwinTab('profiles') }}
        />
      </ContentBody>
    </ContentBox>
  );
}
