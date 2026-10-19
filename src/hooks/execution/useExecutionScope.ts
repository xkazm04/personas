import { useEffect } from 'react';
import * as Sentry from '@sentry/react';

/**
 * The views currently tagging, oldest mount first. The Sentry scope is ONE
 * slot per tag key, so the tag must always name the newest view still
 * mounted, and an unmount must hand the slot back to the view underneath it.
 */
interface ScopeEntry {
  executionId: string | null | undefined;
  personaId: string | null | undefined;
}
const mountedScopes: ScopeEntry[] = [];

function applyTopScope(): void {
  const top = mountedScopes[mountedScopes.length - 1];
  Sentry.setTag('execution_id', top?.executionId || undefined);
  Sentry.setTag('persona_id', top?.personaId || undefined);
}

/**
 * Sets `execution_id` / `persona_id` as Sentry scope tags for the lifetime of
 * the mounted view, so any error captured while an execution is being
 * inspected (or streamed live) is queryable in Discover by that execution.
 *
 * Mirrors the Rust-side `tags.execution_id` / `tags.persona_id` convention
 * from ADR 2026-05-10-sentry-execution-scope-tags: the frontend has a single
 * browser-tab Sentry client, so the tags are one slot per key for the whole
 * tab. Concurrent mounts are normal -- the mini-player is mounted for the
 * whole run while the execution detail or the monitor drawer opens and closes
 * on top of it -- so the slot holds the NEWEST view still mounted. Closing a
 * view restores the one beneath it (the old per-view clear left the running
 * mini-player's errors untagged after any inspector closed), and an event
 * captured after every execution view has closed carries no tag at all.
 *
 * Pass `null`/`undefined` to skip tagging (e.g. no active execution yet).
 */
export function useExecutionScope(
  executionId: string | null | undefined,
  personaId: string | null | undefined,
): void {
  useEffect(() => {
    if (!executionId && !personaId) return;

    const entry: ScopeEntry = { executionId, personaId };
    mountedScopes.push(entry);
    applyTopScope();

    return () => {
      const idx = mountedScopes.indexOf(entry);
      if (idx >= 0) mountedScopes.splice(idx, 1);
      applyTopScope();
    };
  }, [executionId, personaId]);
}
