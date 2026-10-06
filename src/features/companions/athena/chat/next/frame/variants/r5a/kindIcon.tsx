/**
 * One glyph per waiting-item kind, shared by the decision sheet's queue pips,
 * its eyebrow and the thread board's gate rows.
 *
 * TODO(prototype, 2026-10-07): athena chat round 5 - consolidate after the owner picks.
 */

import { ListChecks, Map, MessageCircleMore, OctagonAlert, Scale, ShieldCheck, SquareTerminal, TriangleAlert, type LucideIcon } from 'lucide-react';
import type { WorkItemKind } from '../../../useWorkforce';

const ICON: Record<WorkItemKind, LucideIcon> = {
  session_request: SquareTerminal,
  decision: Scale,
  approval: ShieldCheck,
  plan: Map,
  failure: OctagonAlert,
  warning: TriangleAlert,
  nudge: MessageCircleMore,
  assignment: ListChecks,
};

export function KindIcon({ kind, className }: { kind: WorkItemKind; className?: string }) {
  const Icon = ICON[kind];
  return <Icon className={className} aria-hidden />;
}
