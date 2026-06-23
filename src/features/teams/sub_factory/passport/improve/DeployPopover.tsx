// The "Deploy Claude Code" popover (P3) — for code-requiring gaps (context graph,
// CLAUDE.md, tests, observability). Surfaces the applicable golden-standard
// upgrade actions for a row: a context SCAN, or a Claude-Code TASK whose precise
// prompt is previewable. Queue (safe, review-then-run) or Deploy now (runs the
// CLI; auto-PRs on green). Portalled + anchored like the other improve popovers.
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Rocket, X, ScanSearch, ChevronDown, ChevronRight } from 'lucide-react';

import { useToastStore } from '@/stores/toastStore';
import { useImproveActivityStore } from '@/stores/improveActivityStore';
import { derivePassportFromMetadata } from '../passportDerive';
import { useImprove } from './ImproveContext';
import { applicableDeployActions, type DeployAction } from './deployActions';
import { ConnectorSection } from './ConnectorSection';
import { SkillsSection } from './SkillsSection';
import { connectorSpecFor } from './connectors';
import { LevelLadder } from './LevelLadder';
import { ladderFor } from './levels';
import { dimensionReason } from './provenance';

const WIDTH = 340;

export function DeployPopover({
  slug, rowKey, anchor, onClose,
}: {
  slug: string;
  rowKey: string;
  anchor: DOMRect | null;
  onClose: () => void;
}) {
  const engine = useImprove();
  const addToast = useToastStore((s) => s.addToast);
  const panelRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const raw = engine?.getRaw(slug);
  const passport = raw ? derivePassportFromMetadata(raw.meta, raw.project, { hasSkills: raw.hasSkills, evidence: raw.evidence }) : null;
  const actions = passport ? applicableDeployActions(rowKey, passport) : [];
  const showConnector = Boolean(passport && connectorSpecFor(rowKey)?.applicable(passport));
  const showSkills = rowKey === 'skills' && (raw?.skillsToAdd?.length ?? 0) > 0;
  const ladder = passport ? ladderFor(rowKey, passport) : null;
  const reason = raw ? dimensionReason(rowKey, raw) : null;

  useLayoutEffect(() => {
    if (!anchor) { setPos(null); return; }
    const panelH = panelRef.current?.offsetHeight ?? 240;
    const spaceBelow = window.innerHeight - anchor.bottom;
    const top = spaceBelow < panelH + 14 && anchor.top > spaceBelow ? Math.max(8, anchor.top - panelH - 6) : anchor.bottom + 6;
    const left = Math.max(8, Math.min(anchor.left, window.innerWidth - WIDTH - 8));
    setPos({ top, left });
  }, [anchor, expanded]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    const onDown = (e: MouseEvent) => { if (panelRef.current && !panelRef.current.contains(e.target as Node)) onClose(); };
    window.addEventListener('keydown', onKey);
    const id = window.setTimeout(() => document.addEventListener('mousedown', onDown), 0);
    return () => { window.removeEventListener('keydown', onKey); window.clearTimeout(id); document.removeEventListener('mousedown', onDown); };
  }, [onClose]);

  if (!engine || !raw || !passport || !anchor || (actions.length === 0 && !showConnector && !showSkills && !ladder)) return null;

  // Marks this exact cell busy so its gear spins + disables until the run's
  // terminal event fires (resolved by run id in eventBridge → endByRun).
  const markBusy = (runId: string | undefined, kind: 'deploy' | 'scan') => {
    if (runId) useImproveActivityStore.getState().start(`${slug}:${rowKey}`, runId, kind);
  };

  const run = async (a: DeployAction, mode: 'scan' | 'queue' | 'deploy') => {
    setBusy(a.id);
    try {
      if (mode === 'scan') {
        const scanId = await engine.runContextScan(slug);
        markBusy(scanId, 'scan');
        addToast(`Context scan started for ${raw.project.name}`, 'success');
      } else {
        const title = a.taskTitle?.(raw.project) ?? a.label;
        const prompt = a.prompt?.(raw.project, passport) ?? '';
        if (mode === 'queue') { await engine.queueTask(slug, title, prompt); addToast(`Queued “${title}” for ${raw.project.name}`, 'success'); }
        else { const taskId = await engine.deployNow(slug, title, prompt); markBusy(taskId, 'deploy'); addToast(`Deploying Claude Code on ${raw.project.name} — auto-PR on green`, 'success'); }
      }
      onClose();
    } catch {
      addToast('Couldn’t start the upgrade', 'error');
    } finally {
      setBusy(null);
    }
  };

  // Every project that has the same gap — backs "Queue for all N".
  const eligibleForBatch = (a: DeployAction) =>
    (engine.allRaw() ?? [])
      .map((r) => ({ r, p: derivePassportFromMetadata(r.meta, r.project, { hasSkills: r.hasSkills, evidence: r.evidence }) }))
      .filter(({ p }) => a.applicable(p));

  const runBatch = async (a: DeployAction) => {
    const eligible = eligibleForBatch(a);
    setBusy(a.id);
    try {
      await Promise.all(eligible.map(({ r, p }) => engine.queueTask(r.project.id, a.taskTitle?.(r.project) ?? a.label, a.prompt?.(r.project, p) ?? '')));
      addToast(`Queued “${a.label}” for ${eligible.length} projects`, 'success');
      onClose();
    } catch {
      addToast('Couldn’t queue the batch', 'error');
    } finally {
      setBusy(null);
    }
  };

  return createPortal(
    <div
      ref={panelRef}
      role="dialog"
      aria-label={`Deploy upgrade for ${raw.project.name}`}
      style={{ top: pos?.top ?? anchor.bottom + 6, left: pos?.left ?? anchor.left, width: WIDTH, visibility: pos ? 'visible' : 'hidden' }}
      className="fixed z-[9995] rounded-modal border border-primary/15 bg-background shadow-elevation-4 overflow-hidden"
    >
      <div className="flex items-center gap-1.5 px-3 py-2 border-b border-primary/10 bg-primary/[0.04]">
        <Rocket className="w-3.5 h-3.5 text-primary flex-shrink-0" aria-hidden />
        <span className="typo-caption font-semibold text-foreground truncate">Upgrade {raw.project.name}</span>
        <button type="button" onClick={onClose} aria-label="Close" className="ml-auto p-0.5 rounded-interactive text-foreground hover:bg-secondary/40 transition-colors">
          <X className="w-3.5 h-3.5" />
        </button>
      </div>

      <div className="p-2 space-y-1.5 max-h-[420px] overflow-y-auto">
        {reason && (
          <div className="rounded-interactive border border-primary/10 bg-primary/[0.03] px-2 py-1.5">
            <span className="typo-label text-foreground/40 block mb-0.5">Why this rating</span>
            <span className="typo-caption text-foreground/60 leading-snug" style={{ fontWeight: 400 }}>{reason}</span>
          </div>
        )}
        {ladder && <LevelLadder rowKey={rowKey} passport={passport} />}
        {showConnector && <ConnectorSection slug={slug} rowKey={rowKey} onClose={onClose} />}
        {showSkills && <SkillsSection slug={slug} onClose={onClose} />}
        {actions.map((a) => (
          <div key={a.id} className="rounded-interactive border border-primary/10 bg-secondary/15 p-2">
            <div className="flex items-start gap-2">
              {a.kind === 'scan'
                ? <ScanSearch className="w-3.5 h-3.5 mt-0.5 text-primary/70 flex-shrink-0" aria-hidden />
                : <Rocket className="w-3.5 h-3.5 mt-0.5 text-primary/70 flex-shrink-0" aria-hidden />}
              <div className="min-w-0">
                <span className="typo-caption font-medium text-foreground block">{a.label}</span>
                <span className="typo-caption text-foreground/55 block leading-snug" style={{ fontWeight: 400 }}>{a.hint}</span>
              </div>
            </div>

            {a.kind === 'task' && (
              <button
                type="button"
                onClick={() => setExpanded((e) => (e === a.id ? null : a.id))}
                className="mt-1.5 inline-flex items-center gap-1 typo-caption text-foreground/60 hover:text-foreground transition-colors"
              >
                {expanded === a.id ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
                {expanded === a.id ? 'Hide prompt' : 'View prompt'}
              </button>
            )}
            {a.kind === 'task' && expanded === a.id && (
              <pre className="mt-1 max-h-44 overflow-y-auto rounded-interactive bg-background/60 border border-primary/10 p-2 typo-code text-foreground/75 whitespace-pre-wrap">{a.prompt?.(raw.project, passport)}</pre>
            )}

            <div className="flex items-center justify-end gap-1.5 mt-2">
              {a.kind === 'scan' ? (
                <ActionButton primary onClick={() => run(a, 'scan')} busy={busy === a.id} label="Run scan" />
              ) : (
                <>
                  <ActionButton onClick={() => run(a, 'queue')} busy={busy === a.id} label="Queue task" />
                  <ActionButton primary onClick={() => run(a, 'deploy')} busy={busy === a.id} label="Deploy now" title="Runs Claude Code on the repo and opens a PR on green" />
                </>
              )}
            </div>
            {a.kind === 'task' && eligibleForBatch(a).length > 1 && (
              <button type="button" onClick={() => runBatch(a)} disabled={busy === a.id} className="block ml-auto mt-1 typo-caption text-primary hover:underline disabled:opacity-50">
                Queue for all {eligibleForBatch(a).length} projects that need this →
              </button>
            )}
          </div>
        ))}
      </div>
    </div>,
    document.body,
  );
}

function ActionButton({ label, onClick, busy, primary, title }: { label: string; onClick: () => void; busy: boolean; primary?: boolean; title?: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={busy}
      title={title}
      className={`px-2.5 py-1 rounded-interactive typo-caption font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed ${
        primary
          ? 'text-primary bg-primary/15 hover:bg-primary/25 border border-primary/25'
          : 'text-foreground hover:bg-secondary/40 border border-primary/10'
      }`}
    >
      {busy ? '…' : label}
    </button>
  );
}
