// Coverage pipeline — the Auto Scan successor, sweep edition. Each project
// context maps to its full matched LENS BUNDLE (keyword rules); dispatching a
// row spawns ONE Fleet session running `/scan-sweep --lenses <keys> <context>`
// which reads the context's code once and judges it through every bundled
// lens. The backlog digest is refreshed right before dispatch so the sweep
// reads the current backlog. Bounded + operator-confirmed: rows are
// checkbox-selected (default: the first few least-covered) before dispatch.
import { useEffect, useMemo, useState } from 'react';
import { Info, PlayCircle, Workflow } from 'lucide-react';

import { exportBacklogDigest, listContexts, listMemoryNodes, type DevContext } from '@/api/devTools/devTools';
import { Button } from '@/features/shared/components/buttons';
import { Tooltip } from '@/features/shared/components/display/Tooltip';
import { silentCatch } from '@/lib/silentCatch';
import { useTranslation } from '@/i18n/useTranslation';

import { matchAgentsToContext, presetByAgentKey } from '../../constants/presetSkills';

/** Default rows pre-selected per run — keeps a click-through dispatch bounded. */
const DEFAULT_SELECTED = 5;
/** Bundle chips shown before collapsing into a "+n" tail. */
const MAX_BUNDLE_CHIPS = 6;

interface PipelineRow {
  context: DevContext;
  /** Matched lens KEYS for this context (agent keys, best match first). */
  lenses: string[];
  /** Fresh Memory-Ledger nodes attributed to this context (30d) — 0 = uncovered. */
  freshNodes: number;
}

/** One lens chip — the preset's icon in its color, tooltip = lens label. */
function LensChip({ lensKey }: { lensKey: string }) {
  const visual = presetByAgentKey(lensKey);
  if (!visual) return null;
  return (
    <Tooltip content={visual.label} placement="top">
      <span
        className="inline-flex items-center justify-center w-4.5 h-4.5 rounded-interactive border flex-shrink-0"
        style={{ color: visual.color, borderColor: `${visual.color}40`, backgroundColor: `${visual.color}14` }}
      >
        <visual.icon className="w-2.5 h-2.5" aria-hidden strokeWidth={1.75} />
      </span>
    </Tooltip>
  );
}

export function CoveragePipeline({ projectId, busy, onDispatch }: {
  projectId: string;
  busy: boolean;
  /** Fleet-dispatch a skill with args (`/scan-sweep --lenses <keys> <context>`). */
  onDispatch: (skill: string, args: string) => void;
}) {
  const { t, tx } = useTranslation();
  const d = t.plugins.dev_tools;
  const [rows, setRows] = useState<PipelineRow[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [dispatched, setDispatched] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    setDispatched(new Set());
    Promise.all([
      listContexts(projectId).catch((e) => { silentCatch('coveragePipeline contexts')(e); return [] as DevContext[]; }),
      // Fresh-first active ledger nodes — counted per context to rank rows.
      listMemoryNodes(projectId, null, 500).catch((e) => { silentCatch('coveragePipeline nodes')(e); return []; }),
    ]).then(([ctx, nodes]) => {
      if (!alive) return;
      const freshByContext = new Map<string, number>();
      for (const n of nodes) {
        if (!n.contextId) continue;
        freshByContext.set(n.contextId, (freshByContext.get(n.contextId) ?? 0) + 1);
      }
      const built: PipelineRow[] = ctx
        .map((c) => ({
          context: c,
          lenses: matchAgentsToContext(c),
          freshNodes: freshByContext.get(c.id) ?? 0,
        }))
        // Least-covered first — the pipeline's whole point.
        .sort((a, b) => a.freshNodes - b.freshNodes || a.context.name.localeCompare(b.context.name));
      setRows(built);
      setSelected(new Set(built.slice(0, DEFAULT_SELECTED).map((r) => r.context.id)));
      setLoading(false);
    });
    return () => { alive = false; };
  }, [projectId]);

  const toggle = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const runnable = useMemo(
    () => rows.filter((r) => selected.has(r.context.id) && !dispatched.has(r.context.id)),
    [rows, selected, dispatched],
  );

  const run = async () => {
    // Digest first: the sweep's "never re-propose" contract only holds if the
    // file reflects the backlog as of THIS dispatch, not the last scan's.
    await exportBacklogDigest(projectId).catch(silentCatch('coveragePipeline digest'));
    for (const r of runnable) {
      onDispatch('scan-sweep', `--lenses ${r.lenses.join(',')} ${r.context.name}`);
    }
    setDispatched((prev) => new Set([...prev, ...runnable.map((r) => r.context.id)]));
  };

  return (
    <section className="rounded-card border border-primary/12 bg-secondary/[0.12]" data-testid="coverage-pipeline">
      <div className="flex items-center gap-2 px-3 py-2 bg-primary/[0.04] border-b border-primary/10 rounded-t-card">
        <Workflow className="w-4 h-4 text-primary flex-shrink-0" aria-hidden />
        <Tooltip content={d.skills_pipeline_subtitle} placement="top">
          <span className="inline-flex items-center gap-1.5 typo-body font-semibold text-foreground">
            {d.skills_pipeline_title}
            <Info className="w-3 h-3 text-foreground/35" aria-hidden />
          </span>
        </Tooltip>
        <span className="ml-auto flex-shrink-0">
          <Button
            variant="accent"
            accentColor="violet"
            size="sm"
            icon={<PlayCircle className="w-3.5 h-3.5" />}
            disabled={busy || runnable.length === 0}
            onClick={run}
            data-testid="coverage-pipeline-run"
          >
            {tx(d.skills_pipeline_run_sweeps, { n: runnable.length })}
          </Button>
        </span>
      </div>
      <div className="max-h-64 overflow-y-auto px-3 py-1">
        {loading ? (
          <p className="typo-caption text-foreground/45 py-6 text-center">{d.skills_pipeline_loading}</p>
        ) : rows.length === 0 ? (
          <p className="typo-caption text-foreground/45 py-6 text-center">{d.skills_pipeline_no_contexts}</p>
        ) : (
          <ul>
            {rows.map((r) => {
              const done = dispatched.has(r.context.id);
              return (
                <li key={r.context.id} className="flex items-center gap-2.5 py-1.5 border-b border-foreground/[0.08] last:border-b-0">
                  <input
                    type="checkbox"
                    checked={selected.has(r.context.id)}
                    disabled={done}
                    onChange={() => toggle(r.context.id)}
                    className="accent-[var(--color-primary)] flex-shrink-0"
                    aria-label={r.context.name}
                  />
                  <span className="typo-caption font-medium text-foreground truncate flex-1 min-w-0">{r.context.name}</span>
                  <span className="typo-label text-foreground/45 tabular-nums flex-shrink-0">
                    {tx(d.skills_pipeline_fresh_nodes, { n: r.freshNodes })}
                  </span>
                  {/* The lens BUNDLE the sweep will evaluate — one chip per lens. */}
                  <span className="flex items-center gap-1 flex-shrink-0">
                    {r.lenses.slice(0, MAX_BUNDLE_CHIPS).map((lens) => <LensChip key={lens} lensKey={lens} />)}
                    {r.lenses.length > MAX_BUNDLE_CHIPS && (
                      <span className="typo-label text-foreground/45 tabular-nums">+{r.lenses.length - MAX_BUNDLE_CHIPS}</span>
                    )}
                  </span>
                  <span className={`typo-label flex-shrink-0 w-16 text-right ${done ? 'text-status-info' : 'text-foreground/35'}`}>
                    {done ? d.skills_pipeline_dispatched : ''}
                  </span>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </section>
  );
}
