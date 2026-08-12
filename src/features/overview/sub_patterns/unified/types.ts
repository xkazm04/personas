// Shared contract for the unified-modal variants. The wrapper
// (UnifiedPracticeModal) owns governance + evidence fetching; variants own
// only presentation — a variant swap can never change behaviour. Mirrors the
// PracticeDetailModal/PracticeDetailLedger split it replaces.
import type { DevProject } from '@/lib/bindings/DevProject';
import type { WorkspaceKnowledgeEvidence } from '@/lib/bindings/WorkspaceKnowledgeEvidence';

import type { KnowledgeItemView } from '../libraryModel';
import type { PracticeHierarchy } from './hierarchyModel';

export type EvidenceByItem = ReadonlyMap<string, readonly WorkspaceKnowledgeEvidence[]>;

export interface UnifiedViewProps {
  hierarchy: PracticeHierarchy;
  /** The item whose governance panel is active (anchor by default; variants
   *  may refocus it when the user selects a manifestation). */
  focus: KnowledgeItemView;
  onFocus: (item: KnowledgeItemView) => void;
  /** Switch the whole modal to a sibling principle (graph cluster entry). */
  onAnchor: (item: KnowledgeItemView) => void;
  /** Evidence rows per knowledge id; absent key = not yet loaded. */
  evidence: EvidenceByItem;
  /** Ids whose evidence fetch is in flight. */
  evidenceLoading: ReadonlySet<string>;
  projectById: Map<string, DevProject>;
  busy: boolean;
  onDecide: (item: KnowledgeItemView, decision: 'adopt' | 'reject' | 'deprecate') => void;
  onRollout?: (item: KnowledgeItemView) => void;
  onClose: () => void;
}
