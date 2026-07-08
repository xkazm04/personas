import { ArrowRight, Clock, Database, FileCode2, Globe, Play, Plus, Settings2 } from 'lucide-react';
import type { ReactNode } from 'react';

import type { ScraperConfig, DatasetSummary } from '@/api/scraper';
import AsyncButton from '@/features/shared/components/buttons/AsyncButton';
import Button from '@/features/shared/components/buttons/Button';
import { RelativeTime } from '@/features/shared/components/display/RelativeTime';

import {
  cadenceLabel,
  parseStatus,
  ruleFields,
  type ScraperVariantProps,
} from './useScraperData';

/**
 * Variant 2 — "Pipeline". Mental model: an ETL data-flow diagram. Each scrape is
 * a left-to-right pipeline — Sources → Extract → Dataset — so you read it as
 * "where the data comes from, what's pulled out, where it lands". The schedule
 * is the cadence the pipeline pulses; the run/status live in the footer.
 *
 * Extractable: PipelineNode, FlowArrow.
 */
export function ScraperPipeline({ data, onNew, onEdit }: ScraperVariantProps) {
  const byDataset = new Map(data.datasets.map((d) => [d.name, d]));

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="typo-section-title text-foreground">Pipelines</h1>
          <p className="typo-caption text-muted-foreground">Source → extract → change-detected dataset.</p>
        </div>
        <Button variant="primary" onClick={onNew}>
          <Plus className="size-4" /> New scrape
        </Button>
      </div>

      {data.configs.length === 0 ? (
        <div className="flex flex-col items-center gap-3 rounded-card border border-dashed border-primary/15 py-16">
          <p className="typo-body text-muted-foreground">No pipelines yet.</p>
          <Button variant="primary" onClick={onNew}>
            <Plus className="size-4" /> New scrape
          </Button>
        </div>
      ) : (
        <div className="space-y-3">
          {data.configs.map((c) => (
            <PipelineCard
              key={c.id}
              config={c}
              dataset={byDataset.get(c.dataset)}
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

function PipelineCard({
  config,
  dataset,
  running,
  onRun,
  onEdit,
}: {
  config: ScraperConfig;
  dataset: DatasetSummary | undefined;
  running: boolean;
  onRun: () => void;
  onEdit: () => void;
}) {
  const fields = ruleFields(config.rules);
  const status = parseStatus(config.lastStatus);
  return (
    <div className="rounded-card border border-primary/10 bg-secondary/20 p-4">
      {/* header row */}
      <div className="mb-3 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="text-foreground">{config.name}</span>
          <span className="inline-flex items-center gap-1 rounded-interactive bg-status-info/12 px-2 py-0.5 typo-caption text-status-info">
            <Clock className="size-3" /> {cadenceLabel(config.cron)}
          </span>
          {!config.enabled && (
            <span className="rounded-interactive bg-secondary/60 px-2 py-0.5 typo-caption text-muted-foreground">
              Paused
            </span>
          )}
        </div>
        <button
          onClick={onEdit}
          className="typo-caption text-muted-foreground hover:text-foreground transition-colors"
        >
          <Settings2 className="mr-1 inline size-3.5" />Edit
        </button>
      </div>

      {/* flow */}
      <div className="flex items-stretch gap-2">
        <PipelineNode icon={<Globe className="size-4" />} title="Sources" accent="info">
          <span className="typo-data-lg text-foreground">{config.urls.length}</span>
          <span className="typo-caption text-muted-foreground">
            {config.urls.length === 1 ? 'URL' : 'URLs'}
          </span>
          <span className="mt-1 block max-w-[180px] truncate typo-caption text-muted-foreground/80">
            {hostOf(config.urls[0])}
          </span>
        </PipelineNode>

        <FlowArrow />

        <PipelineNode icon={<FileCode2 className="size-4" />} title="Extract">
          {fields.length === 0 ? (
            <span className="typo-caption text-muted-foreground">no fields</span>
          ) : (
            <span className="flex flex-wrap gap-1">
              {fields.slice(0, 5).map((f) => (
                <span key={f} className="rounded bg-primary/8 px-1.5 py-0.5 font-mono typo-caption text-foreground/80">
                  {f}
                </span>
              ))}
              {fields.length > 5 && (
                <span className="typo-caption text-muted-foreground">+{fields.length - 5}</span>
              )}
            </span>
          )}
          {config.keyField && (
            <span className="mt-1 block typo-caption text-muted-foreground">key: {config.keyField}</span>
          )}
        </PipelineNode>

        <FlowArrow />

        <PipelineNode icon={<Database className="size-4" />} title="Dataset" accent="success">
          <span className="text-foreground">{config.dataset}</span>
          <span className="typo-caption text-muted-foreground">
            {dataset ? `${dataset.count} records` : 'empty'}
          </span>
          {dataset?.lastUpdated && (
            <span className="mt-1 block typo-caption text-muted-foreground/80">
              <RelativeTime timestamp={dataset.lastUpdated} />
            </span>
          )}
        </PipelineNode>
      </div>

      {/* footer */}
      <div className="mt-3 flex items-center justify-between border-t border-primary/8 pt-3">
        <span className="inline-flex items-center gap-1.5 typo-caption" title={status.text}>
          <span
            className={`size-1.5 rounded-full ${
              status.ok === true ? 'bg-status-success' : status.ok === false ? 'bg-status-error' : 'bg-muted-foreground/40'
            }`}
          />
          <span className="text-muted-foreground">
            {config.lastRunAt ? <RelativeTime timestamp={config.lastRunAt} /> : 'never run'}
            {status.ok !== null && <span className="text-foreground/70"> · {status.text}</span>}
          </span>
        </span>
        <AsyncButton variant="secondary" size="sm" isLoading={running} onClick={onRun}>
          <Play className="size-3.5" /> Run now
        </AsyncButton>
      </div>
    </div>
  );
}

function PipelineNode({
  icon,
  title,
  accent,
  children,
}: {
  icon: ReactNode;
  title: string;
  accent?: 'info' | 'success';
  children: ReactNode;
}) {
  const ring =
    accent === 'info' ? 'border-status-info/25' : accent === 'success' ? 'border-status-success/25' : 'border-primary/12';
  return (
    <div className={`flex-1 rounded-interactive border ${ring} bg-background/40 p-3`}>
      <div className="mb-1.5 flex items-center gap-1.5 typo-label text-muted-foreground">
        {icon} {title}
      </div>
      <div className="flex flex-col">{children}</div>
    </div>
  );
}

function FlowArrow() {
  return (
    <div className="flex items-center text-muted-foreground/40">
      <ArrowRight className="size-5" />
    </div>
  );
}

function hostOf(url: string | undefined): string {
  if (!url) return '';
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
}
