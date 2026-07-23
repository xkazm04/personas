// Brand-mark resolver for a dimension node's identified tool. The per-dimension
// lucide icon and Forge glyph now live in the dimension registry (dimRegistry);
// this module keeps only the tool-brand lookup the canvas + menu share.
import { resolveTechIcon } from '@/features/teams/sub_factory/passport/techIcons';

import type { DimNode } from './types';

/** Brand mark for a dimension's identified tool (Supabase, Sentry, GitHub…) —
 *  same resolver the Passport wall uses. Null → fall back to the generic icon. */
export const dimBrand = (node: DimNode) => (node.detail ? resolveTechIcon(node.detail) : null);
