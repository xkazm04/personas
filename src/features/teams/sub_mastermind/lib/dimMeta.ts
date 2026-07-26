// Brand-mark resolver for a dimension node's identified tool. The per-dimension
// lucide icon and Forge glyph now live in the dimension registry (dimRegistry);
// this module keeps only the tool-brand lookup the canvas + menu share.
import { resolveTechIcon } from '@/features/teams/sub_factory/passport/techIcons';
import type { Translations } from '@/i18n/en';

import { DIM_REGISTRY } from './dimRegistry';
import type { DimKey, DimNode } from './types';

/** Brand mark for a dimension's identified tool (Supabase, Sentry, GitHub…) —
 *  same resolver the Passport wall uses. Null → fall back to the generic icon. */
export const dimBrand = (node: DimNode) => (node.detail ? resolveTechIcon(node.detail) : null);

/** Why this cell ignores clicks, appended to its native tooltip — so an inert
 *  square answers the question instead of reading broken. Two honest reasons:
 *  the whole island is sample data, or the dimension is view-only by design
 *  (`viewOnly` in the registry). A cell that is inert merely because nothing is
 *  wired yet gets no hint — there IS something to do there, elsewhere. */
export function cellHint(key: DimKey, isDemo: boolean, t: Translations): string | undefined {
  if (isDemo) return t.mastermind.demo_cell_hint;
  if (DIM_REGISTRY[key]?.viewOnly) return t.mastermind.dim_view_only;
  return undefined;
}
