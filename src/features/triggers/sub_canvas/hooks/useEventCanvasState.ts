import { useReducer, type Dispatch } from 'react';
import type { Edge } from '@xyflow/react';
import type { StickyNoteCategory } from '../nodes/StickyNoteNode';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface StickyNote {
  id: string;
  x: number;
  y: number;
  text: string;
  category: StickyNoteCategory;
}

export interface DryRunState {
  active: boolean;
  eventType: string;
  currentStep: number;
  totalSteps: number;
  completedEdges: Set<string>;
  activeEdge: string | null;
  completedNodes: Set<string>;
  activeNode: string | null;
}

export interface EdgeTooltipState {
  x: number;
  y: number;
  edge: Edge;
}

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

export interface EventCanvasState {
  layoutDirty: boolean;
  paletteCollapsed: boolean;
  liveEventCounts: Record<string, number>;
  stickyNotes: StickyNote[];
  dryRunState: DryRunState | null;
  edgeTooltip: EdgeTooltipState | null;
  assistantOpen: boolean;
}

// ---------------------------------------------------------------------------
// Actions
// ---------------------------------------------------------------------------

export type EventCanvasAction =
  | { type: 'SET_LAYOUT_DIRTY'; dirty: boolean }
  | { type: 'TOGGLE_PALETTE' }
  | { type: 'INCREMENT_LIVE_COUNT'; eventType: string }
  | { type: 'RESET_LIVE_COUNTS' }
  // Sticky notes
  | { type: 'ADD_STICKY_NOTE'; note: StickyNote }
  | { type: 'UPDATE_STICKY_NOTE'; id: string; text: string; category: StickyNoteCategory }
  | { type: 'DELETE_STICKY_NOTE'; id: string }
  | { type: 'UPDATE_STICKY_NOTE_POSITION'; id: string; x: number; y: number }
  | { type: 'SET_STICKY_NOTES'; notes: StickyNote[] }
  // Dry-run
  | { type: 'SET_DRY_RUN_STATE'; state: DryRunState | null }
  | { type: 'CLEAR_DRY_RUN' }
  // Edge tooltip
  | { type: 'SET_EDGE_TOOLTIP'; tooltip: EdgeTooltipState | null }
  // Assistant
  | { type: 'SET_ASSISTANT_OPEN'; open: boolean };

// ---------------------------------------------------------------------------
// Reducer
// ---------------------------------------------------------------------------

const initialState: EventCanvasState = {
  layoutDirty: false,
  paletteCollapsed: false,
  liveEventCounts: {},
  stickyNotes: [],
  dryRunState: null,
  edgeTooltip: null,
  assistantOpen: false,
};

function reducer(state: EventCanvasState, action: EventCanvasAction): EventCanvasState {
  switch (action.type) {
    case 'SET_LAYOUT_DIRTY':
      return { ...state, layoutDirty: action.dirty };
    case 'TOGGLE_PALETTE':
      return { ...state, paletteCollapsed: !state.paletteCollapsed };
    case 'INCREMENT_LIVE_COUNT':
      return {
        ...state,
        liveEventCounts: {
          ...state.liveEventCounts,
          [action.eventType]: (state.liveEventCounts[action.eventType] ?? 0) + 1,
        },
      };
    case 'RESET_LIVE_COUNTS':
      return { ...state, liveEventCounts: {} };

    // Sticky notes
    case 'ADD_STICKY_NOTE':
      return { ...state, stickyNotes: [...state.stickyNotes, action.note] };
    case 'UPDATE_STICKY_NOTE':
      return {
        ...state,
        stickyNotes: state.stickyNotes.map(n =>
          n.id === action.id ? { ...n, text: action.text, category: action.category } : n,
        ),
      };
    case 'DELETE_STICKY_NOTE':
      return { ...state, stickyNotes: state.stickyNotes.filter(n => n.id !== action.id) };
    case 'UPDATE_STICKY_NOTE_POSITION':
      return {
        ...state,
        stickyNotes: state.stickyNotes.map(n =>
          n.id === action.id ? { ...n, x: action.x, y: action.y } : n,
        ),
      };
    case 'SET_STICKY_NOTES':
      return { ...state, stickyNotes: action.notes };

    // Dry-run
    case 'SET_DRY_RUN_STATE':
      return { ...state, dryRunState: action.state };
    case 'CLEAR_DRY_RUN':
      return { ...state, dryRunState: null };

    // Edge tooltip
    case 'SET_EDGE_TOOLTIP':
      return { ...state, edgeTooltip: action.tooltip };

    // Assistant
    case 'SET_ASSISTANT_OPEN':
      return { ...state, assistantOpen: action.open };

    default:
      return state;
  }
}

export function useEventCanvasState(): [EventCanvasState, Dispatch<EventCanvasAction>] {
  return useReducer(reducer, initialState);
}
