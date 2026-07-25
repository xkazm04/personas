// Idea-scan configurator — opened from a project's Ideas dimension cell.
//
// Round: manual parametrization (docs/plans/backlog-memory-loop.md, the step
// before Phase 4's autonomous "scan and decide"). The popover used to fire a
// single-agent scan the instant you clicked an agent; it now exposes the three
// knobs `dev_tools_run_scan` has always accepted, so a scan can be shaped
// before it costs anything:
//   • AGENT COMBINATION — multi-select, so one run can carry several lenses
//   • CONTEXT SCOPE     — none selected = whole project (the command's own rule)
//   • TARGET FINDINGS   — granularity per scanned area; Auto = model default
//
// Every label reuses the Idea Scanner's existing `scan_config_*` vocabulary, so
// this surface added no new translation keys.
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Lightbulb, Play, X } from 'lucide-react';

import { listContexts } from '@/api/devTools/devTools';
import { AGENT_CATEGORIES, SCAN_AGENTS } from '@/features/plugins/dev-tools/constants/scanAgents';
import { RelativeTime } from '@/features/shared/components/display/RelativeTime';
import type { DevContext } from '@/lib/bindings/DevContext';
import type { DevScan } from '@/lib/bindings/DevScan';
import { silentCatch } from '@/lib/silentCatch';
import { useTranslation } from '@/i18n/useTranslation';

const WIDTH = 360;

/** Granularity presets. `null` = Auto (no target injected into the prompt). */
const TARGETS: Array<number | null> = [null, 3, 5, 8];

export interface ScanParams {
  agentKeys: string[];
  /** Empty = whole project (matches run_scan's own scoping rule). */
  contextIds: string[];
  targetCount: number | null;
}

export function IdeaScanPopover({ projectId, name, scans, anchor, busy, onRun, onClose }: {
  /** Dev-project id — the island slug. Used to load scopable contexts. */
  projectId: string;
  name: string;
  /** Recent DevScan rows for this project (newest first) — header context. */
  scans: DevScan[];
  anchor: { x: number; y: number };
  busy: boolean;
  onRun: (params: ScanParams) => void;
  onClose: () => void;
}) {
  const { t, tx } = useTranslation();
  const ds = t.plugins.dev_scanner;
  const panelRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);
  const [agentKeys, setAgentKeys] = useState<Set<string>>(new Set());
  const [contextIds, setContextIds] = useState<Set<string>>(new Set());
  const [targetCount, setTargetCount] = useState<number | null>(null);
  const [contexts, setContexts] = useState<DevContext[]>([]);
  const last = scans[0];

  // Scopable areas for this project. One scoped IPC on open; a project that has
  // never been context-scanned simply shows the "run a context scan first" hint
  // and the scan stays whole-project.
  useEffect(() => {
    let live = true;
    listContexts(projectId)
      .then((rows) => { if (live) setContexts(rows); })
      .catch(silentCatch('mastermind scan contexts'));
    return () => { live = false; };
  }, [projectId]);

  useLayoutEffect(() => {
    const panelH = panelRef.current?.offsetHeight ?? 360;
    const spaceBelow = window.innerHeight - anchor.y;
    const top = spaceBelow < panelH + 14 && anchor.y > spaceBelow ? Math.max(8, anchor.y - panelH - 6) : anchor.y + 6;
    const left = Math.max(8, Math.min(anchor.x, window.innerWidth - WIDTH - 8));
    setPos({ top, left });
  }, [anchor, contexts.length]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    const onDown = (e: MouseEvent) => { if (panelRef.current && !panelRef.current.contains(e.target as Node)) onClose(); };
    window.addEventListener('keydown', onKey);
    const id = window.setTimeout(() => document.addEventListener('mousedown', onDown), 0);
    return () => { window.removeEventListener('keydown', onKey); window.clearTimeout(id); document.removeEventListener('mousedown', onDown); };
  }, [onClose]);

  const toggle = (set: Set<string>, key: string) => {
    const next = new Set(set);
    if (next.has(key)) next.delete(key);
    else next.add(key);
    return next;
  };

  const chip = (active: boolean) =>
    `inline-flex items-center gap-1 px-2 py-1 typo-caption rounded-interactive border transition-colors focus-ring disabled:opacity-40 ${
      active
        ? 'border-primary/40 bg-primary/15 text-foreground'
        : 'border-primary/12 text-foreground/85 hover:bg-primary/10 hover:text-foreground'
    }`;

  return (
    <div
      ref={panelRef}
      className="fixed z-50 rounded-card border border-primary/20 bg-secondary/95 shadow-elevation-3 overflow-hidden flex flex-col"
      style={{ width: WIDTH, top: pos?.top ?? -9999, left: pos?.left ?? -9999, maxHeight: '78vh' }}
      data-testid="mm-idea-scan-popover"
    >
      <div className="flex items-center gap-2 px-3 py-2 border-b border-foreground/10">
        <Lightbulb className="w-4 h-4 text-amber-400 shrink-0" aria-hidden />
        <span className="typo-caption font-semibold text-foreground truncate">{t.mastermind.scan_title} — {name}</span>
        <button
          type="button"
          onClick={onClose}
          aria-label={t.common.close}
          className="ml-auto shrink-0 p-1 rounded-interactive text-foreground/60 hover:text-foreground hover:bg-primary/10 transition-colors focus-ring"
        >
          <X className="w-3.5 h-3.5" aria-hidden />
        </button>
      </div>

      <div className="px-3 py-1.5 border-b border-foreground/[0.07] typo-caption text-foreground/55">
        {busy ? t.mastermind.scan_running : last ? (
          <span className="inline-flex items-center gap-1">
            {t.mastermind.scan_last} <RelativeTime timestamp={last.created_at} className="tabular-nums" /> · {last.scan_type.split(',')[0]}{last.scan_type.includes(',') ? '…' : ''}
          </span>
        ) : t.mastermind.scan_never}
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto px-3 py-2 space-y-3">
        {/* ── Context scope ─────────────────────────────────────────────── */}
        <section>
          <div className="flex items-baseline gap-2 mb-1">
            <span className="typo-label text-foreground/50 uppercase tracking-wider">{ds.scan_config_scope_label}</span>
            {contextIds.size > 0 && (
              <button
                type="button"
                onClick={() => setContextIds(new Set())}
                className="ml-auto typo-caption text-primary hover:underline focus-ring rounded-interactive"
              >
                {ds.scan_config_clear}
              </button>
            )}
          </div>
          {contexts.length === 0 ? (
            <p className="typo-caption text-foreground/45">{ds.scan_config_scope_empty}</p>
          ) : (
            <>
              <div className="flex flex-wrap gap-1">
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => setContextIds(new Set())}
                  className={chip(contextIds.size === 0)}
                  data-testid="mm-scan-scope-all"
                >
                  {ds.scan_config_whole_project}
                </button>
                {contexts.map((c) => (
                  <button
                    key={c.id}
                    type="button"
                    disabled={busy}
                    onClick={() => setContextIds((prev) => toggle(prev, c.id))}
                    title={c.description ?? c.name}
                    className={chip(contextIds.has(c.id))}
                    data-testid={`mm-scan-scope-${c.id}`}
                  >
                    {c.name}
                  </button>
                ))}
              </div>
              <p className="typo-caption text-foreground/45 mt-1">{ds.scan_config_scope_hint}</p>
            </>
          )}
        </section>

        {/* ── Target findings (granularity) ─────────────────────────────── */}
        <section>
          <span className="block typo-label text-foreground/50 uppercase tracking-wider mb-1">{ds.scan_config_granularity_label}</span>
          <div className="flex flex-wrap gap-1">
            {TARGETS.map((n) => (
              <button
                key={n ?? 'auto'}
                type="button"
                disabled={busy}
                onClick={() => setTargetCount(n)}
                className={chip(targetCount === n)}
                data-testid={`mm-scan-target-${n ?? 'auto'}`}
              >
                {n ?? ds.scan_config_granularity_auto}
              </button>
            ))}
          </div>
          <p className="typo-caption text-foreground/45 mt-1">{ds.scan_config_granularity_hint}</p>
        </section>

        {/* ── Agent combination ─────────────────────────────────────────── */}
        <section>
          <div className="flex items-baseline gap-2 mb-1">
            <span className="typo-label text-foreground/50 uppercase tracking-wider">{ds.history_col_agents}</span>
            <span className="typo-caption text-foreground/45 tabular-nums">
              {tx(ds.scan_config_selected_count, { count: agentKeys.size })}
            </span>
            {agentKeys.size > 0 && (
              <button
                type="button"
                onClick={() => setAgentKeys(new Set())}
                className="ml-auto typo-caption text-primary hover:underline focus-ring rounded-interactive"
              >
                {ds.clear_all_btn}
              </button>
            )}
          </div>
          <div className="space-y-2">
            {AGENT_CATEGORIES.map((cat) => {
              const agents = SCAN_AGENTS.filter((a) => a.categoryGroup === cat.key).sort((a, b) => a.label.localeCompare(b.label));
              if (agents.length === 0) return null;
              return (
                <div key={cat.key}>
                  <span className="block typo-caption text-foreground/40 mb-1">{cat.label}</span>
                  <div className="flex flex-wrap gap-1">
                    {agents.map((a) => (
                      <button
                        key={a.key}
                        type="button"
                        disabled={busy}
                        aria-pressed={agentKeys.has(a.key)}
                        onClick={() => setAgentKeys((prev) => toggle(prev, a.key))}
                        title={a.description}
                        className={chip(agentKeys.has(a.key))}
                        data-testid={`mm-scan-agent-${a.key}`}
                      >
                        <span aria-hidden>{a.emoji}</span>
                        {a.label}
                      </button>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        </section>
      </div>

      {/* ── Dispatch ───────────────────────────────────────────────────── */}
      <div className="px-3 py-2 border-t border-foreground/10">
        <button
          type="button"
          disabled={busy || agentKeys.size === 0}
          onClick={() => onRun({
            agentKeys: [...agentKeys],
            contextIds: [...contextIds],
            targetCount,
          })}
          className="w-full inline-flex items-center justify-center gap-1.5 px-3 py-1.5 typo-caption font-medium rounded-interactive bg-primary/15 text-foreground border border-primary/30 hover:bg-primary/25 disabled:opacity-40 disabled:hover:bg-primary/15 transition-colors focus-ring"
          data-testid="mm-scan-run"
        >
          <Play className="w-3.5 h-3.5" aria-hidden />
          {ds.run_scan_btn}{agentKeys.size})
        </button>
      </div>
    </div>
  );
}
