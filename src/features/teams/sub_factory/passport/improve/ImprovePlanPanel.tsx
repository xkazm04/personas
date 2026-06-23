// The Improve Plan panel — the fleet-wide remediation program. Ranks every
// below-target gap across all projects by impact-per-effort and lets the user
// batch-QUEUE the Claude-deploy tasks (safe: createTask, review-then-run) or run
// a context scan inline. The header shows the fleet golden-% now → projected if
// the selected work lands. This is the "build golden apps easily" surface: one
// list that says what to do next, everywhere.
import { useMemo, useState } from 'react';
import { Rocket, ScanSearch, Plug, Sparkles, Wrench, X, Target } from 'lucide-react';

import { BaseModal } from '@/lib/ui/BaseModal';
import { useToastStore } from '@/stores/toastStore';
import { useImprove } from './ImproveContext';
import { buildImprovePlan, fleetGoldenAvg, projectedFleetGolden, type PlanItem, type PlanKind } from './improvePlan';

const KIND_META: Record<PlanKind, { icon: typeof Rocket; label: string; tone: string }> = {
  scan: { icon: ScanSearch, label: 'Scan', tone: 'text-blue-300 border-blue-500/30 bg-blue-500/10' },
  task: { icon: Rocket, label: 'Claude deploy', tone: 'text-violet-300 border-violet-500/30 bg-violet-500/10' },
  connector: { icon: Plug, label: 'Connector', tone: 'text-emerald-300 border-emerald-500/30 bg-emerald-500/10' },
  skills: { icon: Sparkles, label: 'Skills', tone: 'text-amber-300 border-amber-500/30 bg-amber-500/10' },
  standards: { icon: Wrench, label: 'Config', tone: 'text-foreground/70 border-primary/20 bg-primary/10' },
};

const MAX_VISIBLE = 40;

export function ImprovePlanPanel({ open, onClose }: { open: boolean; onClose: () => void }) {
  const engine = useImprove();
  const addToast = useToastStore((s) => s.addToast);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);

  const raws = useMemo(() => engine?.allRaw() ?? [], [engine]);
  const plan = useMemo(() => buildImprovePlan(raws), [raws]);
  const avgNow = useMemo(() => fleetGoldenAvg(raws), [raws]);

  const key = (it: PlanItem) => `${it.projectId}:${it.dimKey}`;
  const selectedItems = plan.filter((it) => selected.has(key(it)));
  const projected = useMemo(() => projectedFleetGolden(raws, selectedItems), [raws, selectedItems]);

  const toggle = (it: PlanItem) =>
    setSelected((prev) => {
      const n = new Set(prev);
      const k = key(it);
      if (n.has(k)) n.delete(k); else n.add(k);
      return n;
    });

  const queueSelected = async () => {
    if (!engine || selectedItems.length === 0) return;
    setBusy(true);
    let queued = 0;
    try {
      for (const it of selectedItems.filter((i) => i.kind === 'task' && i.action)) {
        const raw = engine.getRaw(it.projectId);
        if (!raw || !it.action) continue;
        const title = it.action.taskTitle?.(raw.project) ?? it.action.label;
        const prompt = it.action.prompt?.(raw.project, it.passport) ?? '';
        await engine.queueTask(it.projectId, title, prompt);
        queued++;
      }
      addToast(`Queued ${queued} golden-standard ${queued === 1 ? 'task' : 'tasks'} across the fleet`, 'success');
      onClose();
    } catch {
      addToast('Couldn’t queue the campaign', 'error');
    } finally {
      setBusy(false);
    }
  };

  const runScan = async (it: PlanItem) => {
    if (!engine) return;
    try {
      await engine.runContextScan(it.projectId);
      addToast(`Context scan started for ${it.projectName}`, 'success');
    } catch {
      addToast('Couldn’t start the scan', 'error');
    }
  };

  const selectableTasks = selectedItems.filter((i) => i.kind === 'task');

  return (
    <BaseModal isOpen={open} onClose={onClose} titleId="improve-plan-title" size="lg" panelClassName="bg-background border border-primary/15 rounded-2xl shadow-elevation-4">
      <div className="flex flex-col max-h-[78vh]">
        {/* header — fleet summary */}
        <div className="flex items-center gap-3 px-5 py-3.5 border-b border-primary/10">
          <Target className="w-5 h-5 text-primary flex-shrink-0" aria-hidden />
          <div className="min-w-0">
            <h2 id="improve-plan-title" className="typo-section-title">Improve Plan</h2>
            <p className="typo-caption text-foreground/55">{plan.length} ranked opportunities across {raws.length} projects</p>
          </div>
          <div className="ml-auto flex items-center gap-2 flex-shrink-0">
            <span className="typo-caption text-foreground/55">Fleet golden</span>
            <span className="typo-data-lg font-bold tabular-nums text-foreground">{avgNow}%</span>
            {projected > avgNow && (
              <>
                <span className="text-foreground/40">→</span>
                <span className="typo-data-lg font-bold tabular-nums text-emerald-300">{projected}%</span>
              </>
            )}
          </div>
          <button type="button" onClick={onClose} aria-label="Close" className="p-1 rounded-interactive text-foreground hover:bg-secondary/40 transition-colors">
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* ranked list */}
        <div className="overflow-y-auto px-2 py-2 flex-1">
          {plan.length === 0 ? (
            <p className="text-center py-12 typo-caption text-foreground/55">Every project meets its golden standard 🎉</p>
          ) : (
            <ol className="space-y-1">
              {plan.slice(0, MAX_VISIBLE).map((it, i) => {
                const meta = KIND_META[it.kind];
                const Icon = meta.icon;
                const selectable = it.kind === 'task';
                return (
                  <li key={key(it)} className="flex items-center gap-2.5 px-3 py-2 rounded-interactive border border-primary/[0.08] bg-secondary/15 hover:bg-secondary/25 transition-colors">
                    <span className="typo-caption tabular-nums text-foreground/40 w-5 flex-shrink-0 text-right">{i + 1}</span>
                    {selectable ? (
                      <input type="checkbox" checked={selected.has(key(it))} onChange={() => toggle(it)} className="w-3.5 h-3.5 flex-shrink-0 cursor-pointer" style={{ accentColor: 'var(--primary)' }} />
                    ) : (
                      <span className="w-3.5 flex-shrink-0" />
                    )}
                    <span className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full border typo-label flex-shrink-0 ${meta.tone}`}>
                      <Icon className="w-3 h-3" aria-hidden /> {meta.label}
                    </span>
                    <div className="min-w-0 flex-1">
                      <span className="typo-caption text-foreground block truncate">
                        <span className="font-medium">{it.projectName}</span>
                        <span className="text-foreground/45"> · {it.dimLabel}</span>
                      </span>
                      {it.action && <span className="typo-label text-foreground/45 block truncate">{it.action.label}</span>}
                    </div>
                    <span className="typo-caption tabular-nums font-semibold text-emerald-300 flex-shrink-0">+{it.estGoldenLift}%</span>
                    {it.kind === 'scan' ? (
                      <button type="button" onClick={() => runScan(it)} className="px-2 py-0.5 rounded-interactive typo-label font-medium text-primary bg-primary/15 hover:bg-primary/25 border border-primary/25 transition-colors flex-shrink-0">Run</button>
                    ) : it.kind !== 'task' ? (
                      <span className="typo-label text-foreground/35 flex-shrink-0 whitespace-nowrap">in&nbsp;matrix</span>
                    ) : (
                      <span className="w-8 flex-shrink-0" />
                    )}
                  </li>
                );
              })}
              {plan.length > MAX_VISIBLE && (
                <li className="text-center pt-1 typo-label text-foreground/35">+{plan.length - MAX_VISIBLE} lower-priority opportunities</li>
              )}
            </ol>
          )}
        </div>

        {/* footer — batch */}
        <div className="flex items-center justify-between gap-3 px-5 py-3 border-t border-primary/10 bg-secondary/10">
          <span className="typo-caption text-foreground/55">
            {selectableTasks.length > 0 ? `${selectableTasks.length} deploy ${selectableTasks.length === 1 ? 'task' : 'tasks'} selected` : 'Select deploy tasks to queue them as a campaign'}
          </span>
          <button
            type="button"
            onClick={queueSelected}
            disabled={selectableTasks.length === 0 || busy}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-interactive typo-caption font-medium text-primary bg-primary/15 hover:bg-primary/25 border border-primary/25 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <Rocket className="w-3.5 h-3.5" />
            {busy ? 'Queuing…' : `Queue ${selectableTasks.length || ''} selected`}
          </button>
        </div>
      </div>
    </BaseModal>
  );
}
