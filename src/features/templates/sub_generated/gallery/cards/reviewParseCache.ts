import { parseJsonOrDefault as parseJsonSafe } from '@/lib/utils/parseJson';
import type { PersonaDesignReview } from '@/lib/bindings/PersonaDesignReview';
import type { AgentIR } from '@/lib/types/designTypes';

// ── Cached review field parsing ──────────────────────────────────────
// WeakMap keyed by review object identity — entries are GC'd when the
// review object is no longer referenced (e.g. after a gallery refresh).

export interface CachedReviewFields {
  connectors: string[];
  flowCount: number;
  designResult?: AgentIR | null; // undefined = not yet parsed
}

const reviewParseCache = new WeakMap<PersonaDesignReview, CachedReviewFields>();

/** Parse & cache lightweight fields (connectors, flowCount) for row rendering. */
export function getCachedLightFields(review: PersonaDesignReview): CachedReviewFields {
  let cached = reviewParseCache.get(review);
  if (!cached) {
    cached = {
      connectors: parseJsonSafe(review.connectors_used, []),
      flowCount: parseJsonSafe<unknown[]>(review.use_case_flows, []).length,
    };
    reviewParseCache.set(review, cached);
  }
  return cached;
}

/** Lazily parse & cache the heavy design_result — only called on expansion. */
export function getCachedDesignResult(review: PersonaDesignReview): AgentIR | null {
  const cached = getCachedLightFields(review);
  if (cached.designResult === undefined) {
    cached.designResult = parseJsonSafe<AgentIR | null>(review.design_result, null);
  }
  return cached.designResult;
}

export type ViewMode = 'list' | 'explore';

export type TemplateModal =
  | { type: 'adopt'; review: PersonaDesignReview }
  | { type: 'detail'; review: PersonaDesignReview }
  | { type: 'rebuild'; review: PersonaDesignReview }
  | { type: 'preview'; review: PersonaDesignReview }
  | { type: 'recommended' };
