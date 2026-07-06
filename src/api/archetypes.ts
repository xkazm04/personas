import { invokeWithTimeout as invoke } from '@/lib/tauriInvoke';
import type { ArchetypeCatalog } from '@/lib/bindings/ArchetypeCatalog';

export type { ArchetypeCatalog };
export type { Archetype } from '@/lib/bindings/Archetype';
export type { MemoryStrategy } from '@/lib/bindings/MemoryStrategy';

/**
 * Persona Foundry foundation palette — mentality archetypes + memory
 * strategies, embedded catalog data from `scripts/templates/_archetypes.json`
 * (see `src-tauri/src/engine/archetype_catalog.rs`). Static per app build;
 * callers cache it for the session.
 */
export async function listArchetypes(): Promise<ArchetypeCatalog> {
  return invoke<ArchetypeCatalog>('list_archetypes');
}
