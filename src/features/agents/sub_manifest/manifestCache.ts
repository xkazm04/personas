import { createModuleCache } from '@/hooks/utility/data/useModuleSubscription';
import type { MemoryReviewProposal } from '@/lib/bindings/MemoryReviewProposal';
import type { PersonaManifestView } from '@/lib/bindings/PersonaManifestView';

/**
 * Module-scoped warm caches for the Manifest tab (loading pattern v2,
 * mechanic 4): the editor's lazy sub-tabs fully unmount on nav-away, so a
 * remount paints the last fetch instead of re-ghosting the whole document.
 * Keyed by persona id — multi-entry, so `createModuleCache` (named cap + TTL)
 * is mandatory over a hand-rolled Map.
 */
const OPTS = { ttlMs: 5 * 60_000, maxSize: 8 } as const;

export const manifestCache = createModuleCache<string, PersonaManifestView>(OPTS);
export const manifestProposalsCache = createModuleCache<string, MemoryReviewProposal[]>(OPTS);
