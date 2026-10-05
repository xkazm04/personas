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
import type { AthenaChatEngine } from '../../athenaChatEngine';
import type { FrameLook } from './frameLook';

export interface TopProps {
  look: FrameLook;
  engine: AthenaChatEngine;
  expanded: boolean;
  onExpand: () => void;
  onOpenWaiting: () => void;
}

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
  /** The wrapper surface for the top/bottom/left/center pieces (`VariantFrame`). */
  look: FrameLook;
  /** The top piece's own content. Defaults to the shared `FrameTop` when omitted. */
  Top?: ComponentType<TopProps>;
  RightPanel: ComponentType<RightPanelProps>;
  DecisionStage: ComponentType<DecisionStageProps>;
}
