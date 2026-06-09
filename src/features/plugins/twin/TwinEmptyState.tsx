import { Plus } from 'lucide-react';
import { IconTwin } from '@/features/plugins/PluginIcons';
import { useSystemStore } from '@/stores/systemStore';
import { ContentBox, ContentHeader, ContentBody } from '@/features/shared/components/layout/ContentLayout';
import { Button } from '@/features/shared/components/buttons';
import { useTranslation } from '@/i18n/useTranslation';
import type { LucideIcon } from 'lucide-react';

/**
 * Shared empty state for Twin sub-tabs when no twin is active.
 * Shows the tab icon + title and a CTA to navigate to the Profiles tab.
 */
export function TwinEmptyState({ icon: Icon, title }: { icon: LucideIcon; title: string }) {
  const t = useTranslation().t.twin;
  const setTwinTab = useSystemStore((s) => s.setTwinTab);

  return (
    <ContentBox>
      <ContentHeader
        icon={<Icon className="w-5 h-5 text-violet-400" />}
        iconColor="violet"
        title={title}
        subtitle={t.emptyState.subtitle}
      />
      <ContentBody centered>
        <div className="flex flex-col items-center justify-center py-16">
          <div className="w-16 h-16 rounded-card bg-violet-500/10 border border-violet-500/20 flex items-center justify-center mb-4">
            <IconTwin className="w-8 h-8 text-violet-400/50" />
          </div>
          <p className="typo-body text-primary mb-1">{t.emptyState.noTwinSelected}</p>
          <p className="typo-caption text-foreground mb-4">{t.emptyState.createFirstTwin}</p>
          <Button onClick={() => setTwinTab('profiles')} size="sm" variant="accent" accentColor="violet">
            <Plus className="w-4 h-4 mr-1.5" />
            {t.selector.createTwin}
          </Button>
        </div>
      </ContentBody>
    </ContentBox>
  );
}
