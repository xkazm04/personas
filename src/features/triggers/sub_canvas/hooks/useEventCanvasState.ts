import { useReducer, type Dispatch } from 'react';
import type { ReactFlowInstance, Edge } from '@xyflow/react';

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

export interface EventCanvasState {
  reactFlowInstance: ReactFlowInstance | null;
  layoutDirty: boolean;
  paletteCollapsed: boolean;
  /** Rolling live event counts per eventType (reset every 60s) */
  liveEventCounts: Record<string, number>;
}

// ---------------------------------------------------------------------------
// Actions
// ---------------------------------------------------------------------------

export type EventCanvasAction =
  | { type: 'SET_REACT_FLOW_INSTANCE'; instance: ReactFlowInstance | null }
  | { type: 'SET_LAYOUT_DIRTY'; dirty: boolean }
  | { type: 'TOGGLE_PALETTE' }
  | { type: 'INCREMENT_LIVE_COUNT'; eventType: string }
  | { type: 'RESET_LIVE_COUNTS' };

// ---------------------------------------------------------------------------
// Reducer
// ---------------------------------------------------------------------------

const initialState: EventCanvasState = {
  reactFlowInstance: null,
  layoutDirty: false,
  paletteCollapsed: false,
  liveEventCounts: {},
};

function reducer(state: EventCanvasState, action: EventCanvasAction): EventCanvasState {
  switch (action.type) {
    case 'SET_REACT_FLOW_INSTANCE':
      return { ...state, reactFlowInstance: action.instance };
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
    default:
      return state;
  }
}

export function useEventCanvasState(): [EventCanvasState, Dispatch<EventCanvasAction>] {
  return useReducer(reducer, initialState);
}
