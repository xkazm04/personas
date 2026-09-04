import { createModuleCache } from '@/hooks/utility/data/useModuleSubscription';
import type { PersonaResponsibility } from '@/lib/bindings/PersonaResponsibility';
import type { AttentionLedgerEntry } from '@/lib/bindings/AttentionLedgerEntry';
import type { PersonaEpisode } from '@/lib/bindings/PersonaEpisode';
import type { MemoryReviewProposal } from '@/lib/bindings/MemoryReviewProposal';

/**
 * Module-scoped warm caches for the Life tab (loading pattern v2, mechanic 4):
 * the editor's lazy tabs fully unmount on nav-away, so a remount paints the
 * last fetch instead of re-ghosting. Keyed by persona id — multi-entry, so
 * `createModuleCache` (named cap + TTL) is mandatory over a hand-rolled Map.
 */
const OPTS = { ttlMs: 5 * 60_000, maxSize: 8 } as const;

export const responsibilitiesCache = createModuleCache<string, PersonaResponsibility[]>(OPTS);
export const attentionLedgerCache = createModuleCache<string, AttentionLedgerEntry[]>(OPTS);
export const episodesCache = createModuleCache<string, PersonaEpisode[]>(OPTS);
export const identityCache = createModuleCache<string, string | null>(OPTS);
export const proposalsCache = createModuleCache<string, MemoryReviewProposal[]>(OPTS);
