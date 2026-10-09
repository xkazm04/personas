/**
 * Layer 2's code, split and warmed. The step screen and each preset are their
 * own chunks (Layer 1 never pays for them); this module is the ONE place their
 * import thunks live, so the `React.lazy` components (`lazySteps.ts`) and every
 * prefetch share one promise per chunk - the pattern of
 * `shared/chrome/navPrefetch.ts`.
 *
 * Three signals warm a step before it is opened:
 * - expressed intent: a pointer or focus resting ~100ms on a step's key
 *   (`prefetchStepOnIntent`) fetches the screen, that step's preset chunk,
 *   its detail data (`useStepDetail`'s module cache) and, for Gate and Tests,
 *   the Measure history their strip draws; leaving cancels it;
 * - idle: once Layer 1 has painted, the screen and every preset chunk are
 *   drained through `idlePrefetch`, one per idle slice (`prefetchStepChunksOnIdle`);
 * - dedupe: the first request for a chunk keeps its promise; later ones reuse
 *   it. A failed import drops its entry, so the next intent retries.
 */
import { idlePrefetch } from '@/lib/idlePrefetch';
import { silentCatch } from '@/lib/silentCatch';

import { prefetchLifecycleHistory } from '../history/useLifecycleHistory';
import { prefetchStepDetail } from './useStepDetail';

export const STEP_CHUNKS = {
  screen: () => import('./StepScreen'),
  gate: () => import('../presets/GatePreset'),
  tests: () => import('../presets/TestsPreset'),
  docs: () => import('../presets/DocsPreset'),
  generic: () => import('../presets/GenericPreset'),
} as const;

export type StepChunk = keyof typeof STEP_CHUNKS;
type ChunkModule<K extends StepChunk> = Awaited<ReturnType<(typeof STEP_CHUNKS)[K]>>;

/** Steps whose screen draws the Measure history as a strip (and whose intent warms it). */
export const HISTORY_STEPS: ReadonlySet<string> = new Set(['gate', 'tests']);

/** Rest time before a hover or focus counts as intent. */
export const STEP_INTENT_DELAY_MS = 100;

// Bounded by construction: one entry per key of STEP_CHUNKS (five).
const inFlight: Partial<Record<StepChunk, Promise<unknown>>> = {};
// The chunks that have arrived, by key (five at most): what a caller can render without suspending.
const arrived: Partial<{ [K in StepChunk]: ChunkModule<K> }> = {};
let intentTimer: ReturnType<typeof setTimeout> | null = null;

/** Load a chunk now; idempotent. The lazy components call this too, so they share the promise. */
export function loadStepChunk<K extends StepChunk>(id: K): Promise<ChunkModule<K>> {
  const existing = inFlight[id];
  if (existing) return existing as Promise<ChunkModule<K>>;
  // STEP_CHUNKS[id] is exactly the thunk ChunkModule<K> names; TS cannot narrow an indexed call by K.
  const pending = STEP_CHUNKS[id]() as Promise<ChunkModule<K>>;
  inFlight[id] = pending;
  pending.then((m) => { (arrived as Record<K, ChunkModule<K>>)[id] = m; }, () => {});
  // A failed import forgets itself so the next request retries; the rejection still reaches the caller.
  pending.then(undefined, () => { if (inFlight[id] === pending) delete inFlight[id]; });
  return pending;
}

/**
 * A chunk that has already arrived, or null. The step screen renders from this
 * when it can: a `React.lazy` component suspends on its first render even when
 * its chunk is in, and that one-frame suspension is long enough for Layer 1 to
 * leave before the screen's band mounts, so the pressed key would have nothing
 * to fly from.
 */
export function arrivedStepChunk<K extends StepChunk>(id: K): ChunkModule<K> | null {
  return (arrived[id] as ChunkModule<K> | undefined) ?? null;
}

/** The preset chunk a step's screen mounts. */
export function presetChunkFor(stepId: string): Exclude<StepChunk, 'screen'> {
  return stepId === 'gate' || stepId === 'tests' || stepId === 'docs' ? stepId : 'generic';
}

/** Whether a chunk has been requested (loaded or in flight). For tests and diagnostics. */
export function stepChunkRequested(id: StepChunk): boolean {
  return inFlight[id] !== undefined;
}

function warm(id: StepChunk) {
  loadStepChunk(id).catch(silentCatch('lifecycle:stepChunkPrefetch'));
}

/**
 * Warm everything opening `stepId` needs: the screen, its preset, its detail
 * data (every step's screen reads it: its runs or docs, its backlog items and
 * its evidence, behind the Next panel) and, for Gate and Tests, the history.
 */
export function prefetchStep(projectId: string | null, stepId: string): void {
  warm('screen');
  warm(presetChunkFor(stepId));
  if (projectId) prefetchStepDetail(projectId, stepId);
  if (projectId && HISTORY_STEPS.has(stepId)) prefetchLifecycleHistory(projectId);
}

/** Prefetch after a pointer or focus has rested on a step's key; a sweep along the rail fetches only where it stops. */
export function prefetchStepOnIntent(projectId: string | null, stepId: string): void {
  cancelStepIntent();
  intentTimer = setTimeout(() => {
    intentTimer = null;
    prefetchStep(projectId, stepId);
  }, STEP_INTENT_DELAY_MS);
}

export function cancelStepIntent(): void {
  if (intentTimer !== null) {
    clearTimeout(intentTimer);
    intentTimer = null;
  }
}

/** After Layer 1 paints: the screen first (every step needs it), then the presets. Returns a cancel. */
export function prefetchStepChunksOnIdle(): () => void {
  const order: StepChunk[] = ['screen', 'generic', 'gate', 'tests', 'docs'];
  return idlePrefetch(order.map((id) => () => loadStepChunk(id)), { initialDelayMs: 800 });
}

/** Test-only: forget every chunk request and pending intent. */
export function __resetStepChunksForTests(): void {
  cancelStepIntent();
  for (const key of Object.keys(inFlight) as StepChunk[]) delete inFlight[key];
  for (const key of Object.keys(arrived) as StepChunk[]) delete arrived[key];
}
