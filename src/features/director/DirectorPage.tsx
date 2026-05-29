import { useState } from 'react';
import { Clapperboard, RefreshCw } from 'lucide-react';
import { ContentBox, ContentHeader, ContentBody } from '@/features/shared/components/layout/ContentLayout';
import { Button } from '@/features/shared/components/buttons';
import AsyncButton from '@/features/shared/components/buttons/AsyncButton';
import { PersonaIcon } from '@/features/shared/components/display/PersonaIcon';
import { LoadingSpinner } from '@/features/shared/components/feedback/LoadingSpinner';
import { useSystemStore } from '@/stores/systemStore';
import { useTranslation } from '@/i18n/useTranslation';
import { useDirector } from './useDirector';
import { DirectorOverview } from './panels/DirectorOverview';
import { DirectorRoster } from './panels/DirectorRoster';
import { DirectorReviews } from './panels/DirectorReviews';
import { DirectorMemory } from './panels/DirectorMemory';

/**
 * Director command center — the top-level home for the coaching meta-persona.
 * Owns the shared `useDirector` data/actions and dispatches to one of four
 * panels by the active L2 sub-tab. Header carries the global "review all in
 * scope" action so it's reachable from every tab.
 */
export default function DirectorPage() {
  const { t } = useTranslation();
  const directorTab = useSystemStore((s) => s.directorTab);
  const d = useDirector();
  const [running, setRunning] = useState(false);

  const inScope = d.portfolio?.inScope ?? 0;

  const handleRunAll = async () => {
    setRunning(true);
    try {
      await d.runBatch();
    } finally {
      setRunning(false);
    }
  };

  return (
    <ContentBox>
      <ContentHeader
        icon={
          d.director ? (
            <PersonaIcon icon={d.director.icon} color={d.director.color} size="w-5 h-5" />
          ) : (
            <Clapperboard className="w-5 h-5 text-violet-400" />
          )
        }
        iconColor="violet"
        title={t.director.panel_title}
        subtitle={t.director.subtitle}
        actions={
          <div className="flex items-center gap-2">
            <Button
              variant="secondary"
              size="sm"
              icon={<RefreshCw className={`w-3.5 h-3.5 ${d.refreshing ? 'animate-spin' : ''}`} />}
              onClick={d.refresh}
            >
              {t.director.refresh}
            </Button>
            <AsyncButton
              variant="accent"
              accentColor="violet"
              size="sm"
              isLoading={running}
              loadingText={t.director.running}
              disabled={inScope === 0}
              title={inScope === 0 ? t.director.no_scope_hint : t.director.run_batch_hint}
              onClick={handleRunAll}
              data-testid="director-run-batch"
            >
              {t.director.run_all}
            </AsyncButton>
          </div>
        }
      />

      <ContentBody>
        {!d.ready ? (
          <div className="flex items-center justify-center py-16">
            <LoadingSpinner />
          </div>
        ) : directorTab === 'roster' ? (
          <DirectorRoster d={d} />
        ) : directorTab === 'reviews' ? (
          <DirectorReviews d={d} />
        ) : directorTab === 'memory' ? (
          <DirectorMemory d={d} />
        ) : (
          <DirectorOverview d={d} />
        )}
      </ContentBody>
    </ContentBox>
  );
}
