import type { Node, Edge, ReactFlowInstance } from '@xyflow/react';
import type { DryRunState } from './debuggerTypes';
import type { AlignmentLine } from '../components/AlignmentGuides';
import type { PipelineAnalytics } from '@/lib/bindings/PipelineAnalytics';
import type { PipelineNodeStatus } from './useDerivedCanvasState';
import type { StickyNoteCategory } from '../components/nodes/StickyNoteNode';
import type { PersonaTeamMember } from '@/lib/bindings/PersonaTeamMember';

export interface MemberWithPersonaInfo extends PersonaTeamMember {
  persona_name?: string;
  persona_icon?: string;
  persona_color?: string;
}

// -- Sticky Note ------------------------------------------------------

export interface StickyNote {
  id: string;
  x: number;
  y: number;
  text: string;
  category: StickyNoteCategory;
}

// -- Canvas State -----------------------------------------------------

export interface CanvasState {
  // Save
  saveStatus: 'saved' | 'saving' | 'unsaved';

  // Selection / overlays
  selectedMember: MemberWithPersonaInfo | null;
  contextMenu: { x: number; y: number; member: MemberWithPersonaInfo } | null;
  edgeTooltip: { x: number; y: number; edge: Edge } | null;

  // Drag-to-add
  reactFlowInstance: ReactFlowInstance | null;
  ghostNode: Node | null;

  // Pipeline execution
  pipelineRunning: boolean;
  pipelineNodeStatuses: PipelineNodeStatus[];
  pipelineCycleNodeIds: Set<string>;

  // Dry-run
  dryRunActive: boolean;
  dryRunState: DryRunState | null;

  // Alignment guides
  alignmentLines: AlignmentLine[];
  isDraggingNode: boolean;

  // Team memory panel
  memoryPanelOpen: boolean;
  memoriesPulsing: boolean;

  // Sticky notes
  stickyNotes: StickyNote[];

  // Optimizer
  analytics: PipelineAnalytics | null;
  analyticsLoading: boolean;
  dismissedSuggestionIds: Set<string>;

  // Canvas assistant
  assistantApplying: boolean;
}

// -- Actions ----------------------------------------------------------

export type CanvasAction =
  | { type: 'SET_SAVE_STATUS'; status: CanvasState['saveStatus'] }
  | { type: 'SET_SELECTED_MEMBER'; member: MemberWithPersonaInfo | null }
  | { type: 'UPDATE_SELECTED_MEMBER_ROLE'; memberId: string; role: string }
  | { type: 'SET_CONTEXT_MENU'; menu: CanvasState['contextMenu'] }
  | { type: 'SET_EDGE_TOOLTIP'; tooltip: CanvasState['edgeTooltip'] }
  | { type: 'SET_REACT_FLOW_INSTANCE'; instance: ReactFlowInstance | null }
  | { type: 'SET_GHOST_NODE'; node: Node | null }
  | { type: 'SET_PIPELINE_RUNNING'; running: boolean }
  | { type: 'SET_PIPELINE_NODE_STATUSES'; statuses: PipelineNodeStatus[] }
  | { type: 'SET_PIPELINE_CYCLE_NODE_IDS'; ids: Set<string> }
  | { type: 'SET_DRY_RUN_ACTIVE'; active: boolean }
  | { type: 'SET_DRY_RUN_STATE'; state: DryRunState | null }
  | { type: 'SET_ALIGNMENT_LINES'; lines: AlignmentLine[] }
  | { type: 'SET_IS_DRAGGING_NODE'; dragging: boolean }
  | { type: 'SET_MEMORY_PANEL_OPEN'; open: boolean }
  | { type: 'SET_MEMORIES_PULSING'; pulsing: boolean }
  | { type: 'ADD_STICKY_NOTE'; note: StickyNote }
  | { type: 'UPDATE_STICKY_NOTE'; id: string; text: string; category: StickyNoteCategory }
  | { type: 'DELETE_STICKY_NOTE'; id: string }
  | { type: 'UPDATE_STICKY_NOTE_POSITION'; id: string; x: number; y: number }
  | { type: 'SET_ANALYTICS'; analytics: PipelineAnalytics | null }
  | { type: 'SET_ANALYTICS_LOADING'; loading: boolean }
  | { type: 'DISMISS_SUGGESTION'; suggestionId: string }
  | { type: 'RESET_DISMISSED_SUGGESTIONS' }
  | { type: 'SET_ASSISTANT_APPLYING'; applying: boolean }
  | { type: 'RESET_ON_TEAM_SWITCH' };

// -- Initial State ----------------------------------------------------

export const initialCanvasState: CanvasState = {
  saveStatus: 'saved',
  selectedMember: null,
  contextMenu: null,
  edgeTooltip: null,
  reactFlowInstance: null,
  ghostNode: null,
  pipelineRunning: false,
  pipelineNodeStatuses: [],
  pipelineCycleNodeIds: new Set(),
  dryRunActive: false,
  dryRunState: null,
  alignmentLines: [],
  isDraggingNode: false,
  memoryPanelOpen: false,
  memoriesPulsing: false,
  stickyNotes: [],
  analytics: null,
  analyticsLoading: false,
  dismissedSuggestionIds: new Set(),
  assistantApplying: false,
};

// -- Reducer ----------------------------------------------------------

export function canvasReducer(state: CanvasState, action: CanvasAction): CanvasState {
  switch (action.type) {
    case 'SET_SAVE_STATUS':
      return { ...state, saveStatus: action.status };
    case 'SET_SELECTED_MEMBER':
      return { ...state, selectedMember: action.member };
    case 'UPDATE_SELECTED_MEMBER_ROLE':
      if (state.selectedMember?.id === action.memberId) {
        return { ...state, selectedMember: { ...state.selectedMember, role: action.role } };
      }
      return state;
    case 'SET_CONTEXT_MENU':
      return { ...state, contextMenu: action.menu };
    case 'SET_EDGE_TOOLTIP':
      return { ...state, edgeTooltip: action.tooltip };
    case 'SET_REACT_FLOW_INSTANCE':
      return { ...state, reactFlowInstance: action.instance };
    case 'SET_GHOST_NODE':
      return { ...state, ghostNode: action.node };
    case 'SET_PIPELINE_RUNNING':
      return { ...state, pipelineRunning: action.running };
    case 'SET_PIPELINE_NODE_STATUSES':
      return { ...state, pipelineNodeStatuses: action.statuses };
    case 'SET_PIPELINE_CYCLE_NODE_IDS':
      return { ...state, pipelineCycleNodeIds: action.ids };
    case 'SET_DRY_RUN_ACTIVE':
      return { ...state, dryRunActive: action.active };
    case 'SET_DRY_RUN_STATE':
      return { ...state, dryRunState: action.state };
    case 'SET_ALIGNMENT_LINES':
      return { ...state, alignmentLines: action.lines };
    case 'SET_IS_DRAGGING_NODE':
      return { ...state, isDraggingNode: action.dragging };
    case 'SET_MEMORY_PANEL_OPEN':
      return { ...state, memoryPanelOpen: action.open };
    case 'SET_MEMORIES_PULSING':
      return { ...state, memoriesPulsing: action.pulsing };
    case 'ADD_STICKY_NOTE':
      return { ...state, stickyNotes: [...state.stickyNotes, action.note] };
    case 'UPDATE_STICKY_NOTE':
      return {
        ...state,
        stickyNotes: state.stickyNotes.map((n) =>
          n.id === action.id ? { ...n, text: action.text, category: action.category } : n,
        ),
      };
    case 'DELETE_STICKY_NOTE':
      return { ...state, stickyNotes: state.stickyNotes.filter((n) => n.id !== action.id) };
    case 'UPDATE_STICKY_NOTE_POSITION':
      return {
        ...state,
        stickyNotes: state.stickyNotes.map((n) =>
          n.id === action.id ? { ...n, x: action.x, y: action.y } : n,
        ),
      };
    case 'SET_ANALYTICS':
      return { ...state, analytics: action.analytics };
    case 'SET_ANALYTICS_LOADING':
      return { ...state, analyticsLoading: action.loading };
    case 'DISMISS_SUGGESTION':
      return {
        ...state,
        dismissedSuggestionIds: new Set([...state.dismissedSuggestionIds, action.suggestionId]),
      };
    case 'RESET_DISMISSED_SUGGESTIONS':
      return { ...state, dismissedSuggestionIds: new Set() };
    case 'SET_ASSISTANT_APPLYING':
      return { ...state, assistantApplying: action.applying };
    case 'RESET_ON_TEAM_SWITCH':
      return {
        ...state,
        pipelineRunning: false,
        pipelineNodeStatuses: [],
        pipelineCycleNodeIds: new Set(),
        dryRunActive: false,
        dryRunState: null,
        dismissedSuggestionIds: new Set(),
      };
  }
}
