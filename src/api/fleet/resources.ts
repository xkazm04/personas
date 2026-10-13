/**
 * Measured resources IPC: what each live run is consuming of this device now,
 * and what finished runs consumed. Every share is a fraction of this device's
 * capacity in 0..1; `gpu*` is `null` when the platform cannot read GPU
 * engines (never 0).
 *
 * Backing Rust: `src-tauri/src/commands/fleet/resources.rs`. Live samples also
 * arrive on the `fleet-resource-sample` event every 5 s while any run is live;
 * `resourceLiveSamples` is the poll-recovery read.
 */
import { invokeWithTimeout as invoke } from '@/lib/tauriInvoke';
import type { LiveResourceSample } from '@/lib/bindings/LiveResourceSample';
import type { ResourceAxis } from '@/lib/bindings/ResourceAxis';
import type { RunKind } from '@/lib/bindings/RunKind';
import type { RunResourceSummary } from '@/lib/bindings/RunResourceSummary';

export type { LiveResourceSample, ResourceAxis, RunKind, RunResourceSummary };

/** The latest sample of every live run. */
export const resourceLiveSamples = () => invoke<LiveResourceSample[]>('resource_live_samples');

/** A persona's finished-run summaries, newest first. */
export const resourceRunSummaries = (personaId: string, limit?: number) =>
  invoke<RunResourceSummary[]>('resource_run_summaries', { personaId, limit: limit ?? null });
