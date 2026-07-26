import { useState } from 'react';

import type { ScraperConfig } from '@/api/scraper';

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
        {/* Chrome (stat bar, column headers) always renders — ScraperControlRoom
            owns the three-state body (ghost / settled-empty / rows) internally,
            per docs/design/overview-loading.md. A full-page loading gate here
            used to blank the whole Control Room on every mount. */}
        <ScraperControlRoom
          data={data}
          onNew={() => setEditing('new')}
          onEdit={(config) => setEditing(config)}
        />
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
