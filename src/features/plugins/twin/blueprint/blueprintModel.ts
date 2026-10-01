/**
 * The Twin blueprint model, built from what the app already holds (spark
 * twin-portable-blueprint). Pure: `useTwinBlueprint` gathers the sources, this
 * file turns them into `TwinBlueprintModel`, and a test can feed it fixtures
 * without a store or IPC.
 *
 * The absent-value rule of the contract holds here: a source that could not be
 * read is `null` in `BlueprintReads`, and every count derived from it stays
 * `null` in the model rather than collapsing to `0`.
 */
import type { SetupSessionSnapshot } from '@/lib/bindings/SetupSessionSnapshot';
import type { TwinChannel } from '@/lib/bindings/TwinChannel';
import type { TwinCommunication } from '@/lib/bindings/TwinCommunication';
import type { TwinDistilledFact } from '@/lib/bindings/TwinDistilledFact';
import type { TwinPendingMemory } from '@/lib/bindings/TwinPendingMemory';
import type { TwinProfile } from '@/lib/bindings/TwinProfile';
import type { TwinTone } from '@/lib/bindings/TwinTone';

import { deriveReadiness } from '../useTwinReadiness';
import { slotStatusOf } from '../shared/twinStatus';
import { scoreTopicCoverage, tierForCount, topicByCommunication } from '../sub_training/topicCoverage';
import { stepKindOf } from './blueprintDelta';
import type { BlueprintGoal, BlueprintTopic, StepKind, TwinBlueprintModel } from './blueprintContract';
import { voiceChannelsOf } from './blueprintVoice';

/** The bio length readiness counts as a full identity (`useTwinReadiness` BIO_MIN_CHARS). */
export const BIO_TARGET = 50;

/** What the store already holds for the twin, scoped to it. */
export interface BlueprintStoreState {
  profile: TwinProfile;
  tones: readonly TwinTone[];
  channels: readonly TwinChannel[];
  /** The store's approved memories (the readiness source, `twinReadinessApproved`). */
  storeApproved: readonly TwinPendingMemory[];
}

/** What the hook reads itself. `null` = that read failed or has not settled. */
export interface BlueprintReads {
  snapshot: SetupSessionSnapshot | null;
  approved: TwinPendingMemory[] | null;
  pending: TwinPendingMemory[] | null;
  rejected: TwinPendingMemory[] | null;
  facts: TwinDistilledFact[] | null;
  trainingComms: TwinCommunication[] | null;
  openSamples: number | null;
}

export type BlueprintSources = BlueprintStoreState & BlueprintReads;

/** `profile.languages` is a JSON array of codes; anything else reads as none. */
function languagesOf(raw: string | null): string[] {
  if (!raw) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    // INVARIANT: the column is written by twin_update_profile from a string[].
    return Array.isArray(parsed) ? parsed.filter((x): x is string => typeof x === 'string') : [];
  } catch {
    return [];
  }
}

const time = (iso: string | null | undefined) => (iso ? Date.parse(iso) : Number.NaN);

/** The newest of the given ISO times, or null when none parses. */
function newest(times: ReadonlyArray<string | null | undefined>): string | null {
  let best: string | null = null;
  for (const t of times) {
    if (!t || Number.isNaN(time(t))) continue;
    if (best === null || time(t) > time(best)) best = t;
  }
  return best;
}

function trainingOf(sources: BlueprintSources): TwinBlueprintModel['training'] {
  const { snapshot, approved, pending, trainingComms, storeApproved } = sources;
  const byComm = trainingComms ? topicByCommunication(trainingComms) : undefined;
  const approvedCoverage = scoreTopicCoverage([...(approved ?? storeApproved)], byComm);
  const awaitingCoverage = pending ? scoreTopicCoverage(pending, byComm) : null;
  const topics: BlueprintTopic[] = approvedCoverage.map((c, i) => ({
    id: c.id,
    approved: c.count,
    awaiting: awaitingCoverage?.[i]?.count ?? 0,
    tier: tierForCount(c.count),
  }));

  const goals: BlueprintGoal[] = (snapshot?.goals ?? []).map((g) => ({
    id: g.id,
    slot: g.slot,
    title: g.title,
    coverage: Math.min(1, Math.max(0, g.coverage)),
    answered: g.answered,
    state: g.state,
    lastWhy: g.lastWhy,
  }));

  const answeredSteps = (snapshot?.transcript ?? []).filter((s) => s.status === 'answered');
  const kindMix: Partial<Record<StepKind, number>> = {};
  for (const step of answeredSteps) {
    const kind = stepKindOf(step.kind);
    if (kind) kindMix[kind] = (kindMix[kind] ?? 0) + 1;
  }

  return {
    topics,
    goals,
    answered: goals.reduce((sum, g) => sum + g.answered, 0),
    kindMix,
    observations: snapshot?.observations.length ?? 0,
    lastTrainedAt: newest([
      ...answeredSteps.map((s) => s.answeredAt),
      ...(trainingComms ?? []).map((c) => c.occurred_at),
    ]),
  };
}

export function buildBlueprintModel(sources: BlueprintSources): TwinBlueprintModel {
  const { profile, tones, channels, storeApproved, approved, pending, rejected, facts } = sources;
  const bio = profile.bio?.trim() ?? '';
  const role = profile.role?.trim() ?? '';
  const readiness = deriveReadiness(profile, [...tones], [...channels], [...storeApproved]);

  return {
    twinId: profile.id,
    identity: {
      name: profile.name,
      role: role || null,
      bioChars: bio ? bio.length : null,
      bioTarget: BIO_TARGET,
      languages: languagesOf(profile.languages),
    },
    voice: { channels: voiceChannelsOf(tones, channels) },
    knowledge: {
      memories: {
        approved: approved?.length ?? null,
        pending: pending?.length ?? null,
        rejected: rejected?.length ?? null,
      },
      // Self-facts only: a fact scoped to a contact is about someone else, and
      // the Knowledge section is what the twin knows about its owner.
      facts: facts ? facts.filter((f) => f.contact_handle === null).length : null,
      kbBound: profile.knowledge_base_id !== null,
    },
    training: trainingOf(sources),
    readiness: {
      score: readiness.score,
      slots: {
        identity: slotStatusOf(readiness.identity),
        tone: slotStatusOf(readiness.tone),
        channels: slotStatusOf(readiness.channels),
        memories: slotStatusOf(readiness.memories),
      },
    },
    samples: { open: sources.openSamples },
  };
}
