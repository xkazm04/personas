// meshRead - the device mesh as the Activity surface reads it. Pure module: no
// JSX, no i18n, no clock (the clock is applied in `meshSlice.meshLiveness`).
//
// Two adapters live here because the board's line components were written for
// LOCAL things: a peer's agent is drawn by `PersonaLine`, which reads a
// `PersonaCardModel`, and a peer's queue by `QueueLadder`, which reads
// `QueueItem`s over `FleetSession`s. A snapshot carries far less than either
// (no reviews, no messages, no process list, no timestamps), so every field
// the snapshot does not carry is the honest empty value, never a guess.

import type { DeviceAgent } from '@/lib/bindings/DeviceAgent';
import type { DeviceQueueEntry } from '@/lib/bindings/DeviceQueueEntry';
import type { FleetSession } from '@/lib/bindings/FleetSession';
import type { MeshDeviceView } from '@/lib/bindings/MeshDeviceView';
import type { MeshLiveness } from '@/lib/bindings/MeshLiveness';
import type { PersonaCardModel } from '../../../../monitorModel';
import type { QueueItem } from '../../../board/queue/useQueueModel';

/** The device's name, never blank. */
export const deviceName = (d: Pick<MeshDeviceView, 'displayName' | 'peerId'>): string =>
  d.displayName.trim() || d.peerId.slice(0, 8);

export const selfDevice = (devices: readonly MeshDeviceView[]): MeshDeviceView | null =>
  devices.find((d) => d.isSelf) ?? null;

export const peerDevices = (devices: readonly MeshDeviceView[]): MeshDeviceView[] =>
  devices.filter((d) => !d.isSelf);

export const livenessOf = (liveness: Record<string, MeshLiveness>, d: MeshDeviceView): MeshLiveness =>
  d.isSelf ? 'live' : (liveness[d.peerId] ?? 'unknown');

/**
 * A peer agent as a card `PersonaLine` can draw. The line is told it is a
 * peer's by its `peer` prop, so no field is added to a model every other
 * surface shares.
 */
export function peerAgentCard(agent: DeviceAgent): PersonaCardModel {
  return {
    personaId: agent.personaId,
    personaName: agent.name,
    personaIcon: null,
    personaColor: null,
    enabled: agent.enabled,
    reviews: [],
    reviewCounts: { critical: 0, warning: 0, info: 0 },
    topReviewSeverity: null,
    reviewCount: 0,
    messages: [],
    messageCount: 0,
    processes: [],
    running: agent.running ? 1 : 0,
    queued: 0,
    inputRequired: 0,
    draftReady: 0,
    runningSince: null,
    execState: agent.running ? 'running' : 'idle',
    attentionCount: 0,
    healthStatus: null,
    recentStatuses: [],
    successRate: null,
    runsToday: 0,
    totalRecent: 0,
    liveCostUsd: 0,
    liveToolCalls: 0,
  };
}

/** A peer's queued entry as the session a `QueueRung` reads. Timestamps it does not carry are 0. */
function peerQueueSession(entry: DeviceQueueEntry): FleetSession {
  return {
    id: entry.sessionId, claudeSessionId: null, cwd: '', projectLabel: entry.projectLabel ?? '', name: null,
    title: entry.title, args: [], mode: 'headless', state: 'queued',
    lastActivityMs: 0n, lastPtyOutputMs: 0n, lastGrewMs: 0n, createdAtMs: 0n,
    childPid: null, exitCode: null, stateReason: null, athenaActive: false, dozing: false, limitResetAtMs: null,
    staleKind: null, queueRank: entry.rank, queuedAtMs: null, notBeforeMs: null, origin: 'remote',
    athenaFlagged: false, lane: null, reservedBand: null, personaId: null, goalId: null, cycleIndex: null,
    runLabel: null, runId: null, contestId: null, contestProjectId: null, remoteJobId: null, originPeerId: null,
  };
}

/** A peer's queue, rank ascending, as ladder rows. */
export function peerQueueItems(queue: readonly DeviceQueueEntry[]): QueueItem[] {
  return [...queue].sort((a, b) => a.rank - b.rank).map((entry) => ({
    sessionId: entry.sessionId,
    session: peerQueueSession(entry),
    rank: entry.rank,
    origin: 'remote',
    personaId: null,
    goalId: null,
    projectLabel: entry.projectLabel ?? '',
    locked: false,
    estimatedStartMs: null,
    notBeforeMs: null,
  }));
}
