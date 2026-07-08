import { useState } from 'react';
import { Database, Play, Plus, Trash2 } from 'lucide-react';

import type { ScraperConfig } from '@/api/scraper';
import AsyncButton from '@/features/shared/components/buttons/AsyncButton';
import Button from '@/features/shared/components/buttons/Button';
import { LoadingSpinner } from '@/features/shared/components/feedback/LoadingSpinner';
import { RelativeTime } from '@/features/shared/components/display/RelativeTime';
import { SegmentedTabs } from '@/features/shared/components/layout/SegmentedTabs';

import { ScrapeEditorModal } from './ScrapeEditorModal';
import { ScraperControlRoom } from './ScraperControlRoom';
import { ScraperPipeline } from './ScraperPipeline';
import { ScraperNotebook } from './ScraperNotebook';
import {
  cadenceLabel,
  parseStatus,
  useScraperData,
  type ScraperVariantProps,
} from './useScraperData';

type Variant = 'baseline' | 'control' | 'pipeline' | 'notebook';

const VARIANT_TABS = [
  { id: 'control' as const, label: 'Control Room' },
  { id: 'pipeline' as const, label: 'Pipeline' },
  { id: 'notebook' as const, label: 'Field Notebook' },
  { id: 'baseline' as const, label: 'Baseline' },
];

/**
 * Scraper management surface (Phase 1b-2), prototyped via /prototype.
 *
 * Three directional variants over one shared data hook + editor:
 *  - Control Room — dense operations table (monitoring metaphor)
 *  - Pipeline     — source → extract → dataset data-flow cards
 *  - Field Notebook — atmospheric research-journal of observations
 *
 * The switcher + editor modal are hoisted here so every variant shares state.
 */
export default function ScraperPage() {
  const data = useScraperData();
  const [variant, setVariant] = useState<Variant>('control');
  const [editing, setEditing] = useState<ScraperConfig | null | 'new'>(null);

  const variantProps: ScraperVariantProps = {
    data,
    onNew: () => setEditing('new'),
    onEdit: (config) => setEditing(config),
  };

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto max-w-6xl px-8 py-6">
        <div className="mb-5 flex items-center justify-between">
          <SegmentedTabs<Variant>
            tabs={VARIANT_TABS}
            activeTab={variant}
            onTabChange={setVariant}
            ariaLabel="Scraper layout variant"
          />
          <span className="typo-caption text-muted-foreground">Prototype — 3 variants</span>
        </div>

        {data.loading ? (
          <div className="flex h-64 items-center justify-center">
            <LoadingSpinner label="Loading scrapes" />
          </div>
        ) : (
          <>
            {variant === 'control' && <ScraperControlRoom {...variantProps} />}
            {variant === 'pipeline' && <ScraperPipeline {...variantProps} />}
            {variant === 'notebook' && <ScraperNotebook {...variantProps} />}
            {variant === 'baseline' && <ScraperPageBaseline {...variantProps} />}
          </>
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

/**
 * Baseline — deliberately plain reference render. A flat list of scrapes + a
 * datasets list, no metaphor. Kept for A/B against the directional variants.
 */
function ScraperPageBaseline({ data, onNew, onEdit }: ScraperVariantProps) {
  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="typo-section-title text-foreground">Scrapes</h1>
        <Button variant="primary" onClick={onNew}>
          <Plus className="size-4" /> New scrape
        </Button>
      </div>

      {data.configs.length === 0 ? (
        <p className="typo-body text-muted-foreground">No scrapes yet.</p>
      ) : (
        <ul className="divide-y divide-primary/10 rounded-card border border-primary/10">
          {data.configs.map((c) => {
            const status = parseStatus(c.lastStatus);
            return (
              <li key={c.id} className="flex items-center justify-between px-4 py-3">
                <div>
                  <div className="text-foreground">{c.name}</div>
                  <div className="typo-caption text-muted-foreground">
                    {cadenceLabel(c.cron)} · dataset {c.dataset} ·{' '}
                    {c.lastRunAt ? <RelativeTime timestamp={c.lastRunAt} /> : 'never run'}
                    {status.ok === false && <span className="text-status-error"> · failed</span>}
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <AsyncButton
                    variant="secondary"
                    isLoading={data.runningId === c.id}
                    onClick={() => data.run(c.id)}
                  >
                    <Play className="size-4" /> Run
                  </AsyncButton>
                  <Button variant="ghost" onClick={() => onEdit(c)}>Edit</Button>
                  <Button variant="ghost" onClick={() => data.remove(c.id)}>
                    <Trash2 className="size-4" />
                  </Button>
                </div>
              </li>
            );
          })}
        </ul>
      )}

      <div>
        <h2 className="typo-label text-muted-foreground mb-2 flex items-center gap-1.5">
          <Database className="size-3.5" /> Datasets
        </h2>
        {data.datasets.length === 0 ? (
          <p className="typo-caption text-muted-foreground">No records yet.</p>
        ) : (
          <ul className="space-y-1">
            {data.datasets.map((d) => (
              <li key={d.name} className="typo-body text-foreground/90">
                {d.name} — {d.count} records
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
