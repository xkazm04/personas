import { useState } from 'react';
import { AlertTriangle, Database, FlaskConical, Globe, Pencil, Play, Plus, Trash2 } from 'lucide-react';

import { previewScraperExtract, type PreviewRow, type ScraperConfig } from '@/api/scraper';
import AsyncButton from '@/features/shared/components/buttons/AsyncButton';
import Button from '@/features/shared/components/buttons/Button';
import { RelativeTime } from '@/features/shared/components/display/RelativeTime';
import { RevealItem } from '@/features/shared/components/display/RevealItem';
import { useTranslation } from '@/i18n/useTranslation';
import { useRevealTracker } from '@/hooks/utility/interaction/useProgressiveReveal';
import { errMsg } from '@/stores/storeTypes';

import { DatasetInspector } from './DatasetInspector';
import { PreviewResults } from './PreviewResults';
import {
  cadenceLabel,
  parseStatus,
  ruleFields,
  type ScrapeStatusTone,
  type ScraperVariantProps,
} from './useScraperData';

/**
 * Rows in the first viewport that play the one-shot entrance cascade when a
 * fresh result set lands. Beyond this rows render plainly (see
 * docs/design/overview-loading.md, law 4).
 */
const CASCADE_ROWS = 14;

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
  // Which dataset's records are open below the strip. The chips carried a
  // count and nothing behind it; this is the operator's handoff after a run.
  const [openDataset, setOpenDataset] = useState<string | null>(null);
  const scheduled = data.configs.filter((c) => c.cron && c.enabled).length;
  const totalRecords = data.datasets.reduce((n, d) => n + d.count, 0);

  // ── Loading choreography (docs/design/overview-loading.md, row-level) ──
  // No filter context on this table, so the cascade is one-shot per session:
  // a poll/refresh re-delivering the same config ids never replays it.
  const enter = useRevealTracker('scraper-configs');
  // Ghost rows only when the table region would otherwise be empty while a
  // fetch runs. Configs already on screen (incl. from the module cache) are
  // never hidden by a fetch — see useScraperData's cache comment.
  const showGhost = data.loading && data.configs.length === 0;

  return (
    <div className="space-y-5">
      {/* Stat bar — static chrome, always renders. */}
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

      {showGhost ? (
        <ScraperGhostTable />
      ) : data.configs.length === 0 ? (
        <EmptyRow onNew={onNew} />
      ) : (
        <div className="overflow-hidden rounded-card border border-primary/10">
          <table className="w-full text-left">
            <TableHead />
            <tbody className="divide-y divide-primary/8">
              {data.configs.map((c, index) => (
                <Row
                  key={c.id}
                  config={c}
                  // Records the scrape's dataset ALREADY holds. Without it a
                  // zero harvest cannot be told apart from an honest first run,
                  // so collapse detection is off rather than guessed.
                  datasetCount={data.datasets.find((d) => d.name === c.dataset)?.count}
                  order={index}
                  hasEntered={(id) => index >= CASCADE_ROWS || enter.hasEntered(id)}
                  markEntered={enter.markEntered}
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
          {data.datasets.map((d) => {
            const open = openDataset === d.name;
            return (
              <button
                key={d.name}
                type="button"
                aria-expanded={open}
                onClick={() => setOpenDataset(open ? null : d.name)}
                className={`rounded-interactive border px-2.5 py-1 typo-caption transition-colors ${
                  open
                    ? 'border-primary/40 bg-primary/10 text-foreground'
                    : 'border-primary/12 bg-secondary/40 text-foreground/90 hover:bg-secondary/60'
                }`}
              >
                {d.name}
                <span className="text-muted-foreground"> · {d.count}</span>
              </button>
            );
          })}
        </div>
      )}

      {openDataset !== null && (
        <DatasetInspector
          key={openDataset}
          name={openDataset}
          queryDataset={data.queryDataset}
          onClose={() => setOpenDataset(null)}
        />
      )}
    </div>
  );
}

function Row({
  config,
  datasetCount,
  order,
  hasEntered,
  markEntered,
  running,
  onRun,
  onEdit,
  onDelete,
}: {
  config: ScraperConfig;
  datasetCount: number | undefined;
  order: number;
  hasEntered: (id: string) => boolean;
  markEntered: (id: string) => void;
  running: boolean;
  onRun: () => void;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const { t } = useTranslation();
  const fields = ruleFields(config.rules);
  const status = parseStatus(config.lastStatus, datasetCount);

  const [testOpen, setTestOpen] = useState(false);
  const [testRows, setTestRows] = useState<PreviewRow[] | null>(null);
  const [testing, setTesting] = useState(false);
  const [testError, setTestError] = useState<string | null>(null);

  const runTest = async () => {
    const next = !testOpen;
    setTestOpen(next);
    if (next && testRows === null) {
      setTesting(true);
      setTestError(null);
      try {
        setTestRows(await previewScraperExtract(config.urls, config.rules, 1));
      } catch (e) {
        // Structured AppError envelope (`{ error, kind, … }`) — not an Error instance.
        setTestError(errMsg(e, String(e)));
      } finally {
        setTesting(false);
      }
    }
  };

  return (
    <>
    <RevealItem
      as="tr"
      revealId={config.id}
      order={order}
      hasEntered={hasEntered}
      markEntered={markEntered}
      className="group hover:bg-secondary/20 transition-colors"
    >
      <td className="px-4 py-3">
        <div className="flex items-center gap-2">
          {!config.enabled && (
            <span className="size-1.5 rounded-full bg-muted-foreground/40" title="Disabled" />
          )}
          <span className="text-foreground">{config.name}</span>
        </div>
        {config.description ? (
          <span className="block max-w-[280px] truncate typo-caption text-muted-foreground" title={config.description}>
            {config.description}
          </span>
        ) : (
          <span className="typo-caption text-muted-foreground">→ {config.dataset}</span>
        )}
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
        <StatusPill status={status} collapsedLabel={t.plugins.scraper.status_collapsed} />
      </td>
      <td className="px-4 py-3">
        <div className="flex items-center justify-end gap-1 opacity-70 transition-opacity group-hover:opacity-100">
          <AsyncButton variant="ghost" size="sm" isLoading={testing} onClick={runTest} title="Dry-run — no records saved">
            <FlaskConical className="size-3.5" /> Test
          </AsyncButton>
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
    </RevealItem>
    {testOpen && (
      <tr>
        <td colSpan={7} className="bg-background/30 px-4 pb-3">
          <div className="rounded-interactive border border-primary/10 bg-secondary/15 p-3">
            <div className="mb-2 flex items-center gap-1.5 typo-label text-muted-foreground">
              <FlaskConical className="size-3.5" /> Test extraction — dry run, nothing saved
            </div>
            {testError ? (
              <div className="flex items-start gap-2 typo-caption text-status-error">
                <AlertTriangle className="mt-0.5 size-4 shrink-0" />
                <span>{testError}</span>
              </div>
            ) : testing ? (
              <span className="typo-caption text-muted-foreground">Fetching {config.urls[0]}…</span>
            ) : testRows ? (
              <PreviewResults rows={testRows} fieldNames={fields} />
            ) : null}
          </div>
        </td>
      </tr>
    )}
    </>
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

const STATUS_DOT: Record<ScrapeStatusTone, string> = {
  ok: 'bg-status-success',
  error: 'bg-status-error',
  // Collapse is not an error the run reported; it is a success that harvested
  // nothing into a dataset that already had records. Amber, never green.
  collapsed: 'bg-status-warning',
  unknown: 'bg-muted-foreground/40',
};

function StatusPill({
  status,
  collapsedLabel,
}: {
  status: { tone: ScrapeStatusTone; collapsed: boolean; text: string };
  collapsedLabel: string;
}) {
  return (
    <span
      className="inline-flex items-center gap-1.5 typo-caption text-foreground/80"
      data-testid={status.collapsed ? 'scrape-status-collapsed' : 'scrape-status'}
      title={status.collapsed ? collapsedLabel : status.text}
    >
      <span className={`size-1.5 rounded-full ${STATUS_DOT[status.tone]}`} />
      <span className={`max-w-[180px] truncate ${status.collapsed ? 'text-status-warning' : ''}`}>
        {status.text}
      </span>
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

/** Column header row — shared by the real table and the ghost table so the swap moves nothing. */
function TableHead() {
  return (
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
  );
}

// ---------------------------------------------------------------------------
// ScraperGhostTable — calm ghost rows for the ONLY moment the table region has
// nothing to show (a fetch with a cold module cache, e.g. a true first visit).
//
// Each ghost enters via `animate-fade-in` (150ms, fill-mode: both) behind a
// staggered animation-delay starting at 120ms — `both` holds opacity 0 through
// the delay, so a fetch that resolves quickly never paints a single ghost.
// No `animate-pulse` — the entrance stagger is the only motion.
// ---------------------------------------------------------------------------

const GHOST_BAR = 'rounded bg-primary/[0.06]';
/** Deterministic width variation so ghosts read as rows, not a barcode. */
const GHOST_NAME_WIDTHS = ['w-40', 'w-28', 'w-36', 'w-32'];

function ScraperGhostTable() {
  return (
    <div className="overflow-hidden rounded-card border border-primary/10" aria-hidden="true">
      <table className="w-full text-left">
        <TableHead />
        <tbody className="divide-y divide-primary/8">
          {Array.from({ length: 5 }).map((_, i) => {
            const nameW = GHOST_NAME_WIDTHS[i % GHOST_NAME_WIDTHS.length];
            const delay = `${120 + i * 35}ms`;
            return (
              <tr key={i} className="animate-fade-in" style={{ animationDelay: delay }}>
                <td className="px-4 py-3">
                  <span className={`block h-3.5 ${nameW} max-w-full ${GHOST_BAR}`} />
                </td>
                <td className="px-4 py-3"><span className={`inline-block h-3.5 w-8 ${GHOST_BAR}`} /></td>
                <td className="px-4 py-3"><span className={`inline-block h-5 w-24 rounded ${GHOST_BAR}`} /></td>
                <td className="px-4 py-3"><span className={`inline-block h-5 w-20 rounded-interactive ${GHOST_BAR}`} /></td>
                <td className="px-4 py-3"><span className={`inline-block h-3.5 w-16 ${GHOST_BAR}`} /></td>
                <td className="px-4 py-3"><span className={`inline-block h-3.5 w-20 ${GHOST_BAR}`} /></td>
                <td className="px-4 py-3" />
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
