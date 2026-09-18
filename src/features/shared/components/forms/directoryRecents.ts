import { createModuleCache } from '@/hooks/utility/data/useModuleSubscription';

/**
 * Recently picked directories, owned by `DirectoryPickerInput`.
 *
 * Module-scoped, NOT localStorage. The golden path
 * (`docs/concepts/golden-paths/client-state-persistence.md`) reserves web
 * storage for per-surface view state and routes anything durable to
 * `app_settings`, and a convenience list of folders is neither: it is worth
 * surviving a remount - which is all a lazily-unmounted settings panel needs -
 * and not worth a registered backend key. `createModuleCache` rather than a
 * bare `Map` so the cap is named where anyone can read it.
 */
const recentsByScope = createModuleCache<string, string[]>({ maxSize: 8 });

/** Enough to cover "the last few projects" without turning into a file list. */
export const MAX_RECENT_DIRECTORIES = 4;

/** The remembered paths for `scope`, newest first. Always returns an array. */
export function readRecentDirectories(scope: string): string[] {
  return recentsByScope.get(scope) ?? [];
}

/**
 * Record a successful pick and return the new list: most-recent first, no
 * duplicates, capped at {@link MAX_RECENT_DIRECTORIES}.
 */
export function rememberRecentDirectory(scope: string, path: string): string[] {
  const existing = readRecentDirectories(scope);
  const next = [path, ...existing.filter((p) => p !== path)].slice(0, MAX_RECENT_DIRECTORIES);
  recentsByScope.set(scope, next);
  return next;
}

/** Drop one scope's list (or every scope). Tests and a future "clear" action. */
export function forgetRecentDirectories(scope?: string): void {
  if (scope === undefined) recentsByScope.invalidateAll();
  else recentsByScope.invalidate(scope);
}
