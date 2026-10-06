/**
 * The contract every prototype direction implements (decision-center spark,
 * Track B). One direction = one complete design language rendering the hub's
 * three levels on fixture data:
 *
 *   strip (chips + counts) -> peek (anchored list for one chip) -> modal
 *
 * and the modal in all four types (backlog, approval, report, chat).
 *
 * The Lab (`DecisionPrototypeLab`) mounts ONE direction's `Hub` and drives it
 * through `HubProps`; the `initial` prop lets the Lab and the page harness open
 * straight onto a given level/type for screenshots.
 *
 * Fixture data only — a direction never imports a store or an API. Verdicts
 * call `onDecide`, which the Lab applies to its in-memory roster (removes the
 * item, keeps a toast-free log) so the motion of an item LEAVING is visible.
 */
import type { ComponentType } from 'react';
import type {
  ChipCount,
  DecisionItem,
  DecisionModalType,
  HubChip,
} from '../model/decisionModel';
import type { TriageVerdict } from '@/features/agents/quick-answer/triage/triageTypes';

export type DirectionId = 'p1' | 'p2' | 'p3' | 'r2a' | 'r2b' | 'r2c';

/** Where the Lab asks the hub to open. */
export type HubInitial =
  | { level: 'strip' }
  | { level: 'peek'; chip: HubChip }
  | { level: 'modal'; type: DecisionModalType };

export interface PrototypeVerdict {
  item: DecisionItem;
  /** Spine verdict, or `'done'` (report/chat read), `'reply'` (chat sent). */
  verdict: TriageVerdict | 'done' | 'reply';
  branchId?: string;
  reason?: string;
  /** Chat reply text. */
  text?: string;
}

export interface HubProps {
  /** Ordered roster (compareDecision order), all chips. */
  items: DecisionItem[];
  counts: Record<HubChip, ChipCount>;
  /** Accepted ideas awaiting dispatch — the `ready` chip's peek content. */
  ready: DecisionItem[];
  initial: HubInitial;
  onDecide: (verdict: PrototypeVerdict) => void;
}

export interface PrototypeDirection {
  id: DirectionId;
  /** Short name shown in the Lab switcher (data, not JSX copy). */
  name: string;
  /** One line: the idea behind the direction. */
  tagline: string;
  Hub: ComponentType<HubProps>;
}
