import { Sparkles, Plus } from 'lucide-react';
import { useSystemStore } from '@/stores/systemStore';
import { ContentBox, ContentHeader, ContentBody } from '@/features/shared/components/layout/ContentLayout';
import { Button } from '@/features/shared/components/buttons';
import type { LucideIcon } from 'lucide-react';

/**
 * Shared empty state for Twin sub-tabs when no twin is active.
 * Shows the tab icon + title and a CTA to navigate to the Profiles tab.
 */
export function TwinEmptyState({ icon: Icon, title }: { icon: LucideIcon; title: string }) {
  const setTwinTab = useSystemStore((s) => s.setTwinTab);

  return (
    <ContentBox>
      <ContentHeader
        icon={<Icon className="w-5 h-5 text-violet-400" />}
        iconColor="violet"
        title={title}
        subtitle="You need an active twin to use this tab."
      />
      <ContentBody centered>
        <div className="flex flex-col items-center justify-center py-16">
          <div className="w-16 h-16 rounded-card bg-violet-500/10 border border-violet-500/20 flex items-center justify-center mb-4">
            <Sparkles className="w-8 h-8 text-violet-400/50" />
          </div>
          <p className="typo-body text-foreground mb-1">No twin selected</p>
          <p className="typo-caption text-muted-foreground mb-4">Create your first twin to get started.</p>
          <Button onClick={() => setTwinTab('profiles')} size="sm" variant="accent" accentColor="violet">
            <Plus className="w-4 h-4 mr-1.5" />
            Create Twin
          </Button>
        </div>
      </ContentBody>
    </ContentBox>
  );
}
