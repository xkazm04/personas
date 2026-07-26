// Shared contract for the practice-detail variants. The wrapper
// (PracticeDetailModal) owns the state machine — decide(), busy, keyboard
// stepping — and each variant owns only how the content is PRESENTED, so a
// variant swap can never change governance behaviour.
import type { DevProject } from '@/lib/bindings/DevProject';
import type { WorkspaceKnowledge } from '@/lib/bindings/WorkspaceKnowledge';

/** Position within the review queue, plus the stepper. */
export interface PracticeNav {
  /** 0-based index in the queue. */
  index: number;
  total: number;
  /** Move by ±1; the parent clamps and closes past the end. */
  onStep: (delta: -1 | 1) => void;
}

export interface PracticeViewProps {
  practice: WorkspaceKnowledge;
  projectById: Map<string, DevProject>;
  /** Resolved origin project name (or the workspace/removed sentinel). */
  originLabel: string;
  /** Provenance actor_kind, already parsed; null when absent or malformed. */
  actorLabel: string | null;
  busy: boolean;
  /** Status gates: which governance actions this practice currently allows. */
  pending: boolean;
  adopted: boolean;
  onDecide: (decision: 'adopt' | 'reject' | 'deprecate') => void;
  onRollout?: () => void;
  onClose: () => void;
  nav?: PracticeNav;
}
