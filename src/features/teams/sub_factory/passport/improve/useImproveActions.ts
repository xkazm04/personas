// The improve layer's ACTIONS, without a presentation.
//
// `ImproveClassicPanel` owned this logic — resolving the row's provenance,
// ladder, connector applicability and golden-standard actions, and running them
// as scan / queue / deploy / fleet-wide batch. That was fine while the popover
// was the only surface. Console v2 renders the same operations in the modal's
// own visual language, and re-implementing "queue for all N projects that need
// this" a second time is exactly how the two would drift.
//
// So the logic lives here and the presentations are thin: the classic panel is
// one, the Console upgrade rail is another.
import { useState } from 'react';

import { mapWithConcurrency } from '@/lib/concurrency';
import { useToastStore } from '@/stores/toastStore';
import { useImproveActivityStore } from '@/stores/improveActivityStore';

import { derivePassportFromMetadata } from '../passportDerive';
import type { AppPassport } from '../passportModel';
import { useImprove } from './ImproveContext';
import { applicableDeployActions, type DeployAction } from './deployActions';
import { connectorSpecFor } from './connectors';
import { ladderFor } from './levels';
import { dimensionReason } from './provenance';

export interface ImproveActions {
  passport: AppPassport;
  projectName: string;
  /** True once the project has a context map — a never-scanned repo has nothing
   *  to delta against, so it gets a full scan only. */
  hasContextMap: boolean;
  /** One-line "why this rating" provenance, when the row has one. */
  reason: string | null;
  /** The row has a level ladder worth explaining. */
  hasLadder: boolean;
  /** The row's connector gap is open, so the icon grid is worth showing. */
  showConnector: boolean;
  actions: DeployAction[];
  /** Action id currently running. */
  busy: string | null;
  /** Action id → the projects fleet-wide with the same gap. */
  batchSize: (a: DeployAction) => number;
  run: (a: DeployAction, mode: 'scan' | 'queue' | 'deploy', delta?: boolean) => Promise<void>;
  runBatch: (a: DeployAction) => Promise<void>;
  /** The exact prompt an action would send — the "view prompt" disclosure. */
  promptFor: (a: DeployAction) => string;
}

/** Null when the improve engine or the project's row isn't available. */
export function useImproveActions(slug: string, rowKey: string, onDone: () => void): ImproveActions | null {
  const engine = useImprove();
  const addToast = useToastStore((s) => s.addToast);
  const [busy, setBusy] = useState<string | null>(null);

  const raw = engine?.getRaw(slug);
  if (!engine || !raw) return null;

  const passport = derivePassportFromMetadata(raw.meta, raw.project, {
    hasSkills: raw.hasSkills, evidence: raw.evidence, skillCounts: raw.skillCounts, docRot: raw.docRot, memHealth: raw.memHealth,
  });
  const actions = applicableDeployActions(rowKey, passport);

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

  // Every project fleet-wide with the same gap — backs "Queue for all N".
  // Computed once per action, not inline in JSX where the guard and the label
  // both called it and each re-walked the whole fleet.
  const eligibleFor = (a: DeployAction) =>
    (engine.allRaw() ?? [])
      .map((r) => ({ r, p: derivePassportFromMetadata(r.meta, r.project, { hasSkills: r.hasSkills, evidence: r.evidence, skillCounts: r.skillCounts, docRot: r.docRot, memHealth: r.memHealth }) }))
      .filter(({ p }) => a.applicable(p));
  const batch = new Map(actions.map((a) => [a.id, eligibleFor(a)]));

  const runBatch = async (a: DeployAction) => {
    const eligible = batch.get(a.id) ?? eligibleFor(a);
    setBusy(a.id);
    try {
      // Each call CREATES a queued task row — the narrowest cost class here (a
      // cheap DB insert, not a live process), but still real writes against one
      // table, so a modest width avoids a burst insert storm.
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

  return {
    passport,
    projectName: raw.project.name,
    hasContextMap: raw.meta.context_count > 0,
    reason: dimensionReason(rowKey, raw),
    hasLadder: Boolean(ladderFor(rowKey, passport)),
    showConnector: Boolean(connectorSpecFor(rowKey)?.applicable(passport)),
    actions,
    busy,
    batchSize: (a) => batch.get(a.id)?.length ?? 0,
    run,
    runBatch,
    promptFor: (a) => a.prompt?.(raw.project, passport) ?? '',
  };
}
