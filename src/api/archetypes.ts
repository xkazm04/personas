import { invokeWithTimeout as invoke } from '@/lib/tauriInvoke';
import type { ArchetypeCatalog } from '@/lib/bindings/ArchetypeCatalog';

export type { ArchetypeCatalog };
export type { Archetype } from '@/lib/bindings/Archetype';
export type { MemoryStrategy } from '@/lib/bindings/MemoryStrategy';

/**
 * The session cache the docstring below has always demanded and no caller ever
 * implemented. `usePersonaCore` fires this from a mount effect on the compose
 * surface, and that surface unmounts on every navigation away — so a payload
 * that is `include_str!`-embedded in the binary, and therefore cannot change
 * within a session, was re-fetched over IPC on every visit.
 *
 * Cached as the PROMISE, not the value, so two concurrent mounts (StrictMode's
 * double-invoke is exactly this) share one round-trip. `tauriInvoke`'s
 * auto-dedup already collapses those, but only inside a 250 ms window — it is a
 * burst guard, not a session cache, and it cannot span a navigation.
 *
 * A REJECTION IS NEVER CACHED. The consumer's retry affordance
 * (`usePersonaCore.retryLoad`) exists precisely because this call can fail
 * while the app is still starting; memoising the failed promise would freeze a
 * transient error for the life of the process and make that button inert.
 */
let cached: Promise<ArchetypeCatalog> | null = null;

/**
 * Persona Foundry foundation palette — mentality archetypes + memory
 * strategies, embedded catalog data from `scripts/templates/_archetypes.json`
 * (see `src-tauri/src/engine/archetype_catalog.rs`). Static per app build, so
 * the first call in a session is the only one that reaches the backend.
 */
export async function listArchetypes(): Promise<ArchetypeCatalog> {
  if (!cached) cached = fetchCatalog();
  return cached;
}

async function fetchCatalog(): Promise<ArchetypeCatalog> {
  try {
    return await invoke<ArchetypeCatalog>('list_archetypes');
  } catch (err) {
    // Evict, then rethrow unhandled: the consumer owns the error door
    // (`usePersonaCore` routes this to `silentCatch` and paints a retry
    // affordance). Swallowing it here would make the retry look like a
    // success and leave the palette permanently blank.
    cached = null;
    throw err;
  }
}

/**
 * Drop the session cache. For tests only — a module-scoped cache otherwise
 * leaks one test's catalog (or its absence) into the next.
 */
export function __resetArchetypeCacheForTests(): void {
  cached = null;
}
