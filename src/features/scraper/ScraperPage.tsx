import { useState } from 'react';

import type { ScraperConfig } from '@/api/scraper';
import { LoadingSpinner } from '@/features/shared/components/feedback/LoadingSpinner';

import { ScrapeEditorModal } from './ScrapeEditorModal';
import { ScraperControlRoom } from './ScraperControlRoom';
import { useScraperData } from './useScraperData';

/**
 * Scraper management surface (Phase 1b-2). The /prototype round settled on the
 * "Control Room" direction (dense operations table + stat bar) as the baseline;
 * the Pipeline / Field Notebook variants were retired. The editor modal is being
 * separately prototyped (LLM-assisted pipeline builder).
 *
 * Rendered as a Plugins sub-tab (see PluginsSidebarNav / PersonasPage).
 */
export default function ScraperPage() {
  const data = useScraperData();
  const [editing, setEditing] = useState<ScraperConfig | null | 'new'>(null);

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto max-w-6xl px-8 py-6">
        {data.loading ? (
          <div className="flex h-64 items-center justify-center">
            <LoadingSpinner label="Loading scrapes" />
          </div>
        ) : (
          <ScraperControlRoom
            data={data}
            onNew={() => setEditing('new')}
            onEdit={(config) => setEditing(config)}
          />
        )}
      </div>

      <ScrapeEditorModal
        isOpen={editing !== null}
        onClose={() => setEditing(null)}
        initial={editing === 'new' ? null : editing}
        onSave={data.save}
      />
    </div>
  );
}
