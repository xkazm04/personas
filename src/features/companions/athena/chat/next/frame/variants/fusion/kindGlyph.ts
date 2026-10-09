/**
 * Fusion · one glyph per waiting-item kind (the rail's beads, the decision's
 * eyebrow). Carried over from Filament's art module when Filament was retired
 * (2026-10-07), so Fusion owns it.
 */

import { ClipboardList, Map as MapIcon, MessageSquareMore, OctagonAlert, Scale, ShieldCheck, Sparkles, TriangleAlert, type LucideIcon } from 'lucide-react';
import type { WorkItemKind } from '../../../useWorkforce';

export const KIND_GLYPH: Record<WorkItemKind, LucideIcon> = {
  session_request: MessageSquareMore,
  decision: Scale,
  approval: ShieldCheck,
  plan: MapIcon,
  failure: OctagonAlert,
  warning: TriangleAlert,
  nudge: Sparkles,
  assignment: ClipboardList,
};
