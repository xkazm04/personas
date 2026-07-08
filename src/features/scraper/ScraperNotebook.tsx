import { useState } from 'react';
import { BookOpen, ChevronDown, ChevronRight, Eye, Play, Plus } from 'lucide-react';

import type { DatasetRecord, ScraperConfig } from '@/api/scraper';
import AsyncButton from '@/features/shared/components/buttons/AsyncButton';
import Button from '@/features/shared/components/buttons/Button';
import { RelativeTime } from '@/features/shared/components/display/RelativeTime';

import {
  cadenceLabel,
  parseStatus,
  ruleFields,
  type ScraperData,
  type ScraperVariantProps,
} from './useScraperData';

/**
 * Variant 3 — "Field Notebook". Mental model: a researcher's watch journal. Each
 * scrape is an observation entry written in prose — what it watches, how often,
 * when it last swept, what changed — with the extracted fields as margin notes
 * and an expandable peek at the freshest change-detected records. Atmospheric,
 * single-column, narrative. Optimised for "what have my watchers noticed?".
 *
 * Extractable: ObservationCard, RecordPeek.
 */
export function ScraperNotebook({ data, onNew, onEdit }: ScraperVariantProps) {
  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <BookOpen className="size-5 text-status-info" />
          <div>
            <h1 className="typo-section-title text-foreground">Watch journal</h1>
            <p className="typo-caption text-muted-foreground">
              {data.configs.length} watcher{data.configs.length === 1 ? '' : 's'} on your sources.
            </p>
          </div>
        </div>
        <Button variant="primary" onClick={onNew}>
          <Plus className="size-4" /> New watcher
        </Button>
      </div>

      {data.configs.length === 0 ? (
        <div className="rounded-card border border-dashed border-primary/15 py-16 text-center">
          <p className="typo-body text-muted-foreground">
            The journal is empty. Set a watcher on a page and it starts logging what changes.
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {data.configs.map((c) => (
            <ObservationCard
              key={c.id}
              config={c}
              data={data}
              running={data.runningId === c.id}
              onRun={() => data.run(c.id)}
              onEdit={() => onEdit(c)}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function ObservationCard({
  config,
  data,
  running,
  onRun,
  onEdit,
}: {
  config: ScraperConfig;
  data: ScraperData;
  running: boolean;
  onRun: () => void;
  onEdit: () => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const [records, setRecords] = useState<DatasetRecord[] | null>(null);
  const [loadingRecords, setLoadingRecords] = useState(false);
  const fields = ruleFields(config.rules);
  const status = parseStatus(config.lastStatus);

  const toggle = async () => {
    const next = !expanded;
    setExpanded(next);
    if (next && records === null) {
      setLoadingRecords(true);
      setRecords(await data.queryDataset(config.dataset));
      setLoadingRecords(false);
    }
  };

  return (
    <article className="overflow-hidden rounded-card border border-primary/10 bg-secondary/15">
      <div className="flex gap-0">
        {/* accent rail */}
        <div className={`w-1 shrink-0 ${config.enabled ? 'bg-status-info/50' : 'bg-muted-foreground/25'}`} />
        <div className="flex-1 p-4">
          <div className="flex items-start justify-between gap-3">
            <div>
              <h2 className="text-foreground">{config.name}</h2>
              {/* narrative line */}
              <p className="typo-body mt-1 text-foreground/80">
                Watching{' '}
                <span className="text-foreground">
                  {config.urls.length} source{config.urls.length === 1 ? '' : 's'}
                </span>{' '}
                · {cadenceLabel(config.cron).toLowerCase()} ·{' '}
                {config.lastRunAt ? (
                  <>last swept <RelativeTime timestamp={config.lastRunAt} /></>
                ) : (
                  'not yet swept'
                )}
                {status.ok !== null && (
                  <>
                    {' '}·{' '}
                    <span className={status.ok ? 'text-status-success' : 'text-status-error'}>
                      {status.text}
                    </span>
                  </>
                )}
              </p>
              {/* margin notes: extracted fields */}
              {fields.length > 0 && (
                <p className="typo-caption mt-2 text-muted-foreground">
                  Notes:{' '}
                  {fields.map((f, i) => (
                    <span key={f}>
                      <span className="font-mono text-foreground/70">{f}</span>
                      {i < fields.length - 1 ? ', ' : ''}
                    </span>
                  ))}
                  {' '}→ <span className="text-foreground/70">{config.dataset}</span>
                </p>
              )}
            </div>
            <div className="flex shrink-0 items-center gap-1">
              <AsyncButton variant="secondary" size="sm" isLoading={running} onClick={onRun}>
                <Play className="size-3.5" /> Sweep
              </AsyncButton>
              <Button variant="ghost" size="sm" onClick={onEdit}>Edit</Button>
            </div>
          </div>

          {/* peek toggle */}
          <button
            onClick={toggle}
            className="mt-3 inline-flex items-center gap-1 typo-caption text-muted-foreground hover:text-foreground transition-colors"
          >
            {expanded ? <ChevronDown className="size-3.5" /> : <ChevronRight className="size-3.5" />}
            <Eye className="size-3.5" /> {expanded ? 'Hide' : 'Peek at'} latest records
          </button>

          {expanded && (
            <div className="mt-2 rounded-interactive border border-primary/10 bg-background/40 p-3">
              {loadingRecords ? (
                <p className="typo-caption text-muted-foreground">Loading…</p>
              ) : !records || records.length === 0 ? (
                <p className="typo-caption text-muted-foreground">No records yet — run a sweep.</p>
              ) : (
                <ul className="space-y-1.5">
                  {records.slice(0, 5).map((r) => (
                    <li key={r.key} className="flex items-baseline justify-between gap-3">
                      <span className="min-w-0 flex-1 truncate font-mono typo-caption text-foreground/80">
                        {r.key}
                      </span>
                      <span className="shrink-0 typo-caption text-muted-foreground">
                        <RelativeTime timestamp={r.updatedAt} />
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
        </div>
      </div>
    </article>
  );
}
