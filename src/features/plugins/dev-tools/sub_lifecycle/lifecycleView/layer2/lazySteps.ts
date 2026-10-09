// The lazy Layer-2 components, built on the shared chunk promises in
// `stepChunks.ts` so a prefetched chunk is the very promise React.lazy awaits.
// `lazyRetry` keeps one stable lazy instance per chunk and sends a permanent
// failure to the nearest ErrorBoundary.
import { lazyRetry } from '@/lib/lazyRetry';

import { loadStepChunk } from './stepChunks';

export const LazyStepScreen = lazyRetry(() => loadStepChunk('screen').then((m) => ({ default: m.StepScreen })));
export const LazyGatePreset = lazyRetry(() => loadStepChunk('gate').then((m) => ({ default: m.GatePreset })));
export const LazyTestsPreset = lazyRetry(() => loadStepChunk('tests').then((m) => ({ default: m.TestsPreset })));
export const LazyDocsPreset = lazyRetry(() => loadStepChunk('docs').then((m) => ({ default: m.DocsPreset })));
export const LazyGenericPreset = lazyRetry(() => loadStepChunk('generic').then((m) => ({ default: m.GenericPreset })));
