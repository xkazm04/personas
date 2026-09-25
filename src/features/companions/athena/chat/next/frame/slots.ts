/**
 * The Frame · Halo variant slots — the contract the round-3 variant builders
 * fill. `VariantFrame` owns the four-edge layout (left rail, top words, bottom
 * input) and hands two regions to a `HaloSlots` object:
 *
 * - `RightPanel`: the right column of the full-app grid (the usage panel). The
 *   column is `pointer-events-none` and sized to content; the panel owns its
 *   surface (the baseline wears a Halo `FramePiece`) and must set
 *   `pointer-events-auto` on what it paints.
 * - `DecisionStage`: always mounted inside the centre column's middle cell (a
 *   `relative` box between the top and bottom pieces, no transform, so a
 *   `fixed` descendant still anchors to the viewport). The stage owns its own
 *   overlay and positioning: it may fill that cell or cover the whole app when
 *   `open`. The work item's real card is `WorkItemBody` (keep its verbs; a
 *   variant restyles the frame around it).
 *
 * TODO(prototype, 2026-09-22): consolidate the Athena chat switcher.
 */

import type { ComponentType } from 'react';
import type { ProjectColumn } from '../useProcessColumns';
import type { WorkItem } from '../useWorkforce';

export interface RightPanelProps {
  columns: ProjectColumn[];
  waiting: number;
  onOpenItem: (id: string) => void;
  onOpenWaiting: () => void;
}

export interface DecisionStageProps {
  items: WorkItem[];          // everything waiting, priority order (useWorkforce().items)
  open: boolean;              // true when the operator opened decisions (Alt+W, a ring, "waiting")
  focusId: string | null;     // the item to show first
  onFocus: (id: string) => void;
  onClose: () => void;        // back to the conversation
  onSend: (text: string) => void;
}

export interface HaloSlots {
  id: 'base' | 'a' | 'b' | 'c';
  label: string;
  RightPanel: ComponentType<RightPanelProps>;
  DecisionStage: ComponentType<DecisionStageProps>;
}
