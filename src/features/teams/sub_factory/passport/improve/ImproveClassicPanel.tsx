// The improve popover's BODY, as a panel.
//
// This content used to exist only inside `DeployPopover`'s positioned shell:
// the "why this rating" provenance line, the level ladder, the connector icon
// grid, and the applicable golden-standard actions with their prompt preview,
// Queue / Deploy now, and "queue for all N projects that need this" batch.
//
// When the Database and Monitoring rows were given their own modals they
// stopped routing to that popover — and silently lost all five of those
// features. Extracting the body means a modal can carry it verbatim instead of
// re-implementing a worse version, and `DeployPopover` keeps rendering exactly
// what it always did: it is now the shell plus this panel.
import { useState } from 'react';
import { Rocket, ScanSearch, ChevronDown, ChevronRight } from 'lucide-react';

import { mapWithConcurrency } from '@/lib/concurrency';
import { useToastStore } from '@/stores/toastStore';
import { useImproveActivityStore } from '@/stores/improveActivityStore';

import { derivePassportFromMetadata } from '../passportDerive';
import { useImprove } from './ImproveContext';
import { applicableDeployActions, type DeployAction } from './deployActions';
import { ConnectorSection } from './ConnectorSection';
import { connectorSpecFor } from './connectors';
import { LevelLadder } from './LevelLadder';
import { ladderFor } from './levels';
import { dimensionReason } from './provenance';

/** True when there is anything at all to render for this row — the popover uses
 *  it to decide whether to mount, the modal to decide whether to offer the tab. */
export function hasClassicContent(slug: string, rowKey: string, engine: ReturnType<typeof useImprove>): boolean {
  const raw = engine?.getRaw(slug);
  if (!engine || !raw) return false;
  const passport = derivePassportFromMetadata(raw.meta, raw.project, { hasSkills: raw.hasSkills, evidence: raw.evidence, skillCounts: raw.skillCounts, docRot: raw.docRot, memHealth: raw.memHealth });
  return applicableDeployActions(rowKey, passport).length > 0
    || Boolean(connectorSpecFor(rowKey)?.applicable(passport))
    || Boolean(ladderFor(rowKey, passport));
}

export function ImproveClassicPanel({ slug, rowKey, onDone }: {
  slug: string;
  rowKey: string;
  /** Called after a run starts. The popover closes; a modal may stay open. */
  onDone: () => void;
}) {
  const engine = useImprove();
  const addToast = useToastStore((s) => s.addToast);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const raw = engine?.getRaw(slug);
  const passport = raw ? derivePassportFromMetadata(raw.meta, raw.project, { hasSkills: raw.hasSkills, evidence: raw.evidence, skillCounts: raw.skillCounts, docRot: raw.docRot, memHealth: raw.memHealth }) : null;
  if (!engine || !raw || !passport) return null;

  const actions = applicableDeployActions(rowKey, passport);
  const showConnector = Boolean(connectorSpecFor(rowKey)?.applicable(passport));
  const ladder = ladderFor(rowKey, passport);
  const reason = dimensionReason(rowKey, raw);

  // Marks this exact cell busy so its gear spins + disables until the run's
  // terminal event fires (resolved by run id in eventBridge → endByRun).
  const markBusy = (runId: string | undefined, kind: 'deploy' | 'scan') => {
    if (runId) useImproveActivityStore.getState().start(`${slug}:${rowKey}`, runId, kind);
  };

  const run = async (a: DeployAction, mode: 'scan' | 'queue' | 'deploy', delta?: boolean) => {
    setBusy(a.id);
    try {
      if (mode === 'scan') {
        const scanId = await engine.runContextScan(slug, delta);
        markBusy(scanId, 'scan');
        addToast(`Context ${delta ? 're-scan (incremental)' : 'scan'} started for ${raw.project.name}`, 'success');
      } else {
        const title = a.taskTitle?.(raw.project) ?? a.label;
        const prompt = a.prompt?.(raw.project, passport) ?? '';
        if (mode === 'queue') { await engine.queueTask(slug, title, prompt); addToast(`Queued “${title}” for ${raw.project.name}`, 'success'); }
        else { const taskId = await engine.deployNow(slug, title, prompt); markBusy(taskId, 'deploy'); addToast(`Deploying Claude Code on ${raw.project.name}, auto-PR on green`, 'success'); }
      }
      onDone();
    } catch {
      addToast('Couldn’t start the upgrade', 'error');
    } finally {
      setBusy(null);
    }
  };

  // Every project that has the same gap — backs "Queue for all N". Computed
  // once per action here (not inline in JSX, where the guard + the label both
  // called this and re-walked the whole fleet each time).
  function eligibleForBatch(a: DeployAction) {
    return (engine!.allRaw() ?? [])
      .map((r) => ({ r, p: derivePassportFromMetadata(r.meta, r.project, { hasSkills: r.hasSkills, evidence: r.evidence, skillCounts: r.skillCounts, docRot: r.docRot, memHealth: r.memHealth }) }))
      .filter(({ p }) => a.applicable(p));
  }
  const batchByAction = new Map(actions.map((a) => [a.id, eligibleForBatch(a)]));

  const runBatch = async (a: DeployAction) => {
    const eligible = batchByAction.get(a.id) ?? eligibleForBatch(a);
    setBusy(a.id);
    try {
      // "Queue for all N" runs across the whole fleet (30+ projects). Each call
      // CREATES a queued task row — the narrowest cost class here (a cheap DB
      // insert, not a live process), but still real writes against the same
      // task-queue table, so a modest width avoids a burst insert storm.
      const QUEUE_BATCH_CONCURRENCY = 4;
      await mapWithConcurrency(eligible, QUEUE_BATCH_CONCURRENCY, ({ r, p }) =>
        engine.queueTask(r.project.id, a.taskTitle?.(r.project) ?? a.label, a.prompt?.(r.project, p) ?? ''));
      addToast(`Queued “${a.label}” for ${eligible.length} projects`, 'success');
      onDone();
    } catch {
      addToast('Couldn’t queue the batch', 'error');
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="space-y-1.5">
      {reason && (
        <div className="rounded-interactive border border-primary/10 bg-primary/[0.03] px-2 py-1.5">
          <span className="typo-label text-foreground/40 block mb-0.5">Why this rating</span>
          <span className="typo-caption text-foreground/60 leading-snug" style={{ fontWeight: 400 }}>{reason}</span>
        </div>
      )}
      {ladder && <LevelLadder rowKey={rowKey} passport={passport} />}
      {showConnector && <ConnectorSection slug={slug} rowKey={rowKey} onClose={onDone} />}
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
              // Same two modes as the Dev-Tools Context Map: incremental
              // re-scan once a map exists, full scan always. A never-scanned
              // project has nothing to delta against, so it gets full only.
              raw.meta.context_count > 0 ? (
                <>
                  <ActionButton onClick={() => run(a, 'scan', true)} busy={busy === a.id} label="Re-scan (incremental)" title="Only re-derives contexts for files changed since the last scan" />
                  <ActionButton primary onClick={() => run(a, 'scan', false)} busy={busy === a.id} label="Full re-scan" title="Re-maps the whole repo from scratch" />
                </>
              ) : (
                <ActionButton primary onClick={() => run(a, 'scan', false)} busy={busy === a.id} label="Run scan" />
              )
            ) : (
              <>
                <ActionButton onClick={() => run(a, 'queue')} busy={busy === a.id} label="Queue task" />
                <ActionButton primary onClick={() => run(a, 'deploy')} busy={busy === a.id} label="Deploy now" title="Runs Claude Code on the repo and opens a PR on green" />
              </>
            )}
          </div>
          {a.kind === 'task' && (batchByAction.get(a.id)?.length ?? 0) > 1 && (
            <button type="button" onClick={() => runBatch(a)} disabled={busy === a.id} className="block ml-auto mt-1 typo-caption text-primary hover:underline disabled:opacity-50">
              Queue for all {batchByAction.get(a.id)?.length} projects that need this →
            </button>
          )}
        </div>
      ))}
    </div>
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
