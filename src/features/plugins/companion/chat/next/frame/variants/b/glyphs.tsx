/**
 * The glyph vocabulary for Halo · Rows: one icon per process kind (the unit
 * tokens on a row) and one per waiting-item kind (the portrait of a card).
 */

import {
  Activity,
  CalendarClock,
  ClipboardList,
  Flame,
  GitFork,
  Map as MapIcon,
  MessageSquareMore,
  Play,
  ShieldCheck,
  Sparkles,
  TriangleAlert,
  type LucideIcon,
} from 'lucide-react';
import type { ReactNode } from 'react';
import { FleetShipIcon } from '@/features/plugins/fleet/FleetShipIcon';
import type { ProcessKind } from '../../../useProcessColumns';
import type { WorkItemKind } from '../../../useWorkforce';

export const PROCESS_GLYPH: Record<ProcessKind, (p: { className?: string }) => ReactNode> = {
  fleet: ({ className }) => <FleetShipIcon className={className} />,
  liveop: ({ className }) => <Activity className={className} />,
  rundesk: ({ className }) => <Play className={className} />,
  schedule: ({ className }) => <CalendarClock className={className} />,
};

export const CARD_GLYPH: Record<WorkItemKind, LucideIcon> = {
  session_request: MessageSquareMore,
  decision: GitFork,
  approval: ShieldCheck,
  plan: MapIcon,
  failure: Flame,
  warning: TriangleAlert,
  nudge: Sparkles,
  assignment: ClipboardList,
};
