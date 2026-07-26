import { useEffect } from 'react';
import * as Sentry from '@sentry/react';

/**
 * Sets `execution_id` / `persona_id` as Sentry scope tags for the lifetime of
 * the mounted view, so any error captured while an execution is being
 * inspected (or streamed live) is queryable in Discover by that execution.
 *
 * Mirrors the Rust-side `tags.execution_id` / `tags.persona_id` convention
 * from ADR 2026-05-10-sentry-execution-scope-tags: the frontend has a single
 * browser-tab Sentry client (no multi-threaded Hub, no tokio task migration),
 * so a plain `setTag`/clear on mount/unmount is safe here — unlike the Rust
 * side, there's no risk of one execution's tags bleeding onto another's
 * event, since the whole tab is only ever "looking at" one view at a time per
 * hook instance. Concurrent mounts (e.g. the mini-player plus an inspector
 * tab) each set/clear independently; React unmount order guarantees the last
 * writer for a given tag key is whichever view is still mounted, and clearing
 * on unmount (rather than leaving a stale id) means an event captured after
 * every execution view has closed carries no misleading execution/persona
 * tag at all.
 *
 * Pass `null`/`undefined` to skip tagging (e.g. no active execution yet).
 */
export function useExecutionScope(
  executionId: string | null | undefined,
  personaId: string | null | undefined,
): void {
  useEffect(() => {
    if (!executionId && !personaId) return;

    if (executionId) Sentry.setTag('execution_id', executionId);
    if (personaId) Sentry.setTag('persona_id', personaId);

    return () => {
      if (executionId) Sentry.setTag('execution_id', undefined);
      if (personaId) Sentry.setTag('persona_id', undefined);
    };
  }, [executionId, personaId]);
}
