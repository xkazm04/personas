import { Database, Globe, Pencil, Play, Plus, Trash2 } from 'lucide-react';

import type { ScraperConfig } from '@/api/scraper';
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
 * Variant 1 — "Control Room". Mental model: a mission-control monitoring board.
 * Every scrape is a row in a dense operations table (sources · fields · dataset
 * · schedule · last run · status), topped by an at-a-glance stat bar. Optimised
 * for "is the fleet of scrapes healthy and what changed?". Mirrors the
 * Watchtower table aesthetic already in the app.
 *
 * Extractable: StatChip, StatusPill, FieldChips.
 */
export function ScraperControlRoom({ data, onNew, onEdit }: ScraperVariantProps) {
  const scheduled = data.configs.filter((c) => c.cron && c.enabled).length;
  const totalRecords = data.datasets.reduce((n, d) => n + d.count, 0);

  return (
    <div className="space-y-5">
      {/* Stat bar */}
      <div className="flex items-center justify-between rounded-card border border-primary/10 bg-secondary/30 px-5 py-4">
        <div className="flex items-center gap-8">
          <StatChip label="Scrapes" value={data.configs.length} />
          <StatChip label="Scheduled" value={scheduled} accent="info" />
          <StatChip label="Datasets" value={data.datasets.length} />
          <StatChip label="Records" value={totalRecords} accent="success" />
        </div>
        <Button variant="primary" onClick={onNew}>
          <Plus className="size-4" /> New scrape
        </Button>
      </div>

      {data.configs.length === 0 ? (
        <EmptyRow onNew={onNew} />
      ) : (
        <div className="overflow-hidden rounded-card border border-primary/10">
          <table className="w-full text-left">
            <thead>
              <tr className="border-b border-primary/10 bg-secondary/20 typo-label text-muted-foreground">
                <th className="px-4 py-2.5 font-medium">Scrape</th>
                <th className="px-4 py-2.5 font-medium">Sources</th>
                <th className="px-4 py-2.5 font-medium">Fields</th>
                <th className="px-4 py-2.5 font-medium">Schedule</th>
                <th className="px-4 py-2.5 font-medium">Last run</th>
                <th className="px-4 py-2.5 font-medium">Status</th>
                <th className="px-4 py-2.5" />
              </tr>
            </thead>
            <tbody className="divide-y divide-primary/8">
              {data.configs.map((c) => (
                <Row
                  key={c.id}
                  config={c}
                  running={data.runningId === c.id}
                  onRun={() => data.run(c.id)}
                  onEdit={() => onEdit(c)}
                  onDelete={() => data.remove(c.id)}
                />
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Datasets strip */}
      {data.datasets.length > 0 && (
        <div className="flex flex-wrap items-center gap-2">
          <span className="typo-label text-muted-foreground flex items-center gap-1.5">
            <Database className="size-3.5" /> Datasets
          </span>
          {data.datasets.map((d) => (
            <span
              key={d.name}
              className="rounded-interactive border border-primary/12 bg-secondary/40 px-2.5 py-1 typo-caption text-foreground/90"
            >
              {d.name}
              <span className="text-muted-foreground"> · {d.count}</span>
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

function Row({
  config,
  running,
  onRun,
  onEdit,
  onDelete,
}: {
  config: ScraperConfig;
  running: boolean;
  onRun: () => void;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const fields = ruleFields(config.rules);
  const status = parseStatus(config.lastStatus);
  return (
    <tr className="group hover:bg-secondary/20 transition-colors">
      <td className="px-4 py-3">
        <div className="flex items-center gap-2">
          {!config.enabled && (
            <span className="size-1.5 rounded-full bg-muted-foreground/40" title="Disabled" />
          )}
          <span className="text-foreground">{config.name}</span>
        </div>
        <span className="typo-caption text-muted-foreground">→ {config.dataset}</span>
      </td>
      <td className="px-4 py-3 text-foreground/80">
        <span className="inline-flex items-center gap-1">
          <Globe className="size-3.5 text-muted-foreground" /> {config.urls.length}
        </span>
      </td>
      <td className="px-4 py-3">
        <FieldChips fields={fields} />
      </td>
      <td className="px-4 py-3">
        <span
          className={`rounded-interactive px-2 py-0.5 typo-caption ${
            config.cron
              ? 'bg-status-info/12 text-status-info'
              : 'bg-secondary/50 text-muted-foreground'
          }`}
        >
          {cadenceLabel(config.cron)}
        </span>
      </td>
      <td className="px-4 py-3 typo-caption text-muted-foreground">
        {config.lastRunAt ? <RelativeTime timestamp={config.lastRunAt} /> : '—'}
      </td>
      <td className="px-4 py-3">
        <StatusPill status={status} />
      </td>
      <td className="px-4 py-3">
        <div className="flex items-center justify-end gap-1 opacity-70 transition-opacity group-hover:opacity-100">
          <AsyncButton variant="secondary" size="sm" isLoading={running} onClick={onRun}>
            <Play className="size-3.5" /> Run
          </AsyncButton>
          <Button variant="ghost" size="sm" onClick={onEdit} aria-label="Edit">
            <Pencil className="size-3.5" />
          </Button>
          <Button variant="ghost" size="sm" onClick={onDelete} aria-label="Delete">
            <Trash2 className="size-3.5" />
          </Button>
        </div>
      </td>
    </tr>
  );
}

function StatChip({
  label,
  value,
  accent,
}: {
  label: string;
  value: number;
  accent?: 'info' | 'success';
}) {
  const color =
    accent === 'info' ? 'text-status-info' : accent === 'success' ? 'text-status-success' : 'text-foreground';
  return (
    <div className="flex flex-col">
      <span className={`typo-data-lg ${color}`}>{value}</span>
      <span className="typo-label text-muted-foreground">{label}</span>
    </div>
  );
}

function StatusPill({ status }: { status: { ok: boolean | null; text: string } }) {
  const dot =
    status.ok === true ? 'bg-status-success' : status.ok === false ? 'bg-status-error' : 'bg-muted-foreground/40';
  return (
    <span className="inline-flex items-center gap-1.5 typo-caption text-foreground/80" title={status.text}>
      <span className={`size-1.5 rounded-full ${dot}`} />
      <span className="max-w-[180px] truncate">{status.text}</span>
    </span>
  );
}

function FieldChips({ fields }: { fields: string[] }) {
  if (fields.length === 0) return <span className="typo-caption text-muted-foreground">—</span>;
  const shown = fields.slice(0, 3);
  return (
    <span className="flex flex-wrap gap-1">
      {shown.map((f) => (
        <span key={f} className="rounded bg-primary/8 px-1.5 py-0.5 font-mono typo-caption text-foreground/80">
          {f}
        </span>
      ))}
      {fields.length > shown.length && (
        <span className="typo-caption text-muted-foreground">+{fields.length - shown.length}</span>
      )}
    </span>
  );
}

function EmptyRow({ onNew }: { onNew: () => void }) {
  return (
    <div className="flex flex-col items-center gap-3 rounded-card border border-dashed border-primary/15 py-16">
      <p className="typo-body text-muted-foreground">No scrapes yet — define a URL + extraction rules to start.</p>
      <Button variant="primary" onClick={onNew}>
        <Plus className="size-4" /> New scrape
      </Button>
    </div>
  );
}
