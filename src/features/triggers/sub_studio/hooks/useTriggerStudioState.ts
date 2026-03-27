import { useReducer } from 'react';

export interface StudioState {
  paletteCollapsed: boolean;
  selectedChainId: string | null;
  isDirty: boolean;
}

type StudioAction =
  | { type: 'TOGGLE_PALETTE' }
  | { type: 'SELECT_CHAIN'; chainId: string | null }
  | { type: 'MARK_DIRTY' }
  | { type: 'MARK_CLEAN' };

function reducer(state: StudioState, action: StudioAction): StudioState {
  switch (action.type) {
    case 'TOGGLE_PALETTE':
      return { ...state, paletteCollapsed: !state.paletteCollapsed };
    case 'SELECT_CHAIN':
      return { ...state, selectedChainId: action.chainId };
    case 'MARK_DIRTY':
      return { ...state, isDirty: true };
    case 'MARK_CLEAN':
      return { ...state, isDirty: false };
    default:
      return state;
  }
}

const initialState: StudioState = {
  paletteCollapsed: false,
  selectedChainId: null,
  isDirty: false,
};

export function useTriggerStudioState() {
  return useReducer(reducer, initialState);
}
