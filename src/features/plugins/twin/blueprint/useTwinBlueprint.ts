/**
 * The Twin blueprint model, read-only (spark twin-portable-blueprint).
 *
 * Builds `TwinBlueprintModel` from the store slices the app already holds
 * (profile, tones, channels, approved memories), the setup session snapshot
 * (`setupGet` - a pure read, NEVER `setupOpen`, which can start a paid plan)
 * or the live one a caller passes in, and a few counts. Viewing the Detail
 * page must never start LLM work.
 *
 * Every read is settled on its own: one that fails leaves its counts `null`
 * (drawn as "not measured") and the rest of the model stands. A refresh keeps
 * the model on screen while it reads (loading pattern v2: data on screen is
 * sacred); a twin switch drops it, because it describes someone else.
 */
import { useEffect, useMemo, useState } from 'react';

import * as twinApi from '@/api/twin/twin';
import * as sampleApi from '@/api/twin/twinSample';
import * as setupApi from '@/api/twin/twinSetup';
import type { SetupSessionSnapshot } from '@/lib/bindings/SetupSessionSnapshot';
import { silentCatch } from '@/lib/silentCatch';
import { useSystemStore } from '@/stores/systemStore';

import { TRAINING_TOPIC_WINDOW } from '../sub_training/useTrainingSession';
import type { TwinBlueprintModel } from './blueprintContract';
import {
  buildBlueprintModel,
  type BlueprintReads,
  type BlueprintSources,
  type BlueprintStoreState,
} from './blueprintModel';

const SCOPE = 'features/plugins/twin/blueprint/useTwinBlueprint';

export interface UseTwinBlueprintOptions {
  /** The live session snapshot when the caller already holds one (the training overlay); otherwise the hook reads `setupGet`. */
  snapshot?: SetupSessionSnapshot | null;
  /** Bump to refetch the counts (e.g. after an answer or a `twin-sample-updated` event). */
  refreshKey?: number;
}

export interface UseTwinBlueprintResult {
  /** `null` until the first read settles, or when there is no twin. */
  model: TwinBlueprintModel | null;
  loading: boolean;
  /**
   * What the model was built from, for the surfaces that show the text behind
   * a count (the L3 detail drawer, the training overlay's answer beat). `null`
   * exactly when `model` is.
   */
  sources: BlueprintSources | null;
}

function settled<T>(result: PromiseSettledResult<T>, what: string): T | null {
  if (result.status === 'fulfilled') return result.value;
  silentCatch(`${SCOPE}:${what}`)(result.reason);
  return null;
}

/** Every read the blueprint makes. Never rejects: a failed read is a `null` field. */
export async function readBlueprintSources(twinId: string, readSnapshot: boolean): Promise<BlueprintReads> {
  const [snapshot, approved, pending, rejected, facts, comms, samples] = await Promise.allSettled([
    readSnapshot ? setupApi.setupGet(twinId) : Promise.resolve(null),
    twinApi.listPendingMemories(twinId, 'approved'),
    twinApi.listPendingMemories(twinId, 'pending'),
    twinApi.listPendingMemories(twinId, 'rejected'),
    twinApi.listDistilledFacts(twinId),
    twinApi.listCommunications(twinId, 'training', TRAINING_TOPIC_WINDOW),
    sampleApi.sampleProposals(twinId, 'open'),
  ]);
  return {
    snapshot: settled(snapshot, 'setupGet'),
    approved: settled(approved, 'approved'),
    pending: settled(pending, 'pending'),
    rejected: settled(rejected, 'rejected'),
    facts: settled(facts, 'facts'),
    trainingComms: settled(comms, 'trainingComms'),
    // The sample commands answer "not built" until the learn-from-sample
    // backend lands: an expected absence, so it is `null` without a report.
    openSamples: samples.status === 'fulfilled' ? samples.value.length : null,
  };
}

export function useTwinBlueprint(twinId: string | null, options: UseTwinBlueprintOptions = {}): UseTwinBlueprintResult {
  const { snapshot: callerSnapshot, refreshKey = 0 } = options;
  const callerHoldsSnapshot = callerSnapshot !== undefined;

  const profile = useSystemStore((s) => (twinId ? (s.twinProfiles.find((p) => p.id === twinId) ?? null) : null));
  const twinTones = useSystemStore((s) => s.twinTones);
  const twinChannels = useSystemStore((s) => s.twinChannels);
  const twinReadinessApproved = useSystemStore((s) => s.twinReadinessApproved);

  // Scoped to the twin: the slices can still hold a previous twin's rows while
  // a fetch is in flight.
  const store = useMemo<BlueprintStoreState | null>(
    () =>
      profile
        ? {
            profile,
            tones: twinTones.filter((t) => t.twin_id === profile.id),
            channels: twinChannels.filter((c) => c.twin_id === profile.id),
            storeApproved: twinReadinessApproved.filter((m) => m.twin_id === profile.id),
          }
        : null,
    [profile, twinTones, twinChannels, twinReadinessApproved],
  );

  const [reads, setReads] = useState<{ twinId: string; reads: BlueprintReads } | null>(null);

  useEffect(() => {
    if (!twinId) return;
    let cancelled = false;
    void readBlueprintSources(twinId, !callerHoldsSnapshot).then((next) => {
      if (!cancelled) setReads({ twinId, reads: next });
    });
    return () => {
      cancelled = true;
    };
  }, [twinId, refreshKey, callerHoldsSnapshot]);

  const current = reads && reads.twinId === twinId ? reads.reads : null;

  const sources = useMemo<BlueprintSources | null>(() => {
    if (!store || !current) return null;
    const snapshot = callerHoldsSnapshot ? (callerSnapshot ?? null) : current.snapshot;
    return { ...store, ...current, snapshot };
  }, [store, current, callerHoldsSnapshot, callerSnapshot]);

  const model = useMemo(() => (sources ? buildBlueprintModel(sources) : null), [sources]);

  return { model, loading: store !== null && current === null, sources };
}
