import { useReducer, useCallback } from 'react';
import type { Node, ReactFlowInstance } from '@xyflow/react';
import {
  canvasReducer,
  initialCanvasState,
  type CanvasState,
  type CanvasAction,
  type MemberWithPersonaInfo,
  type StickyNote,
} from './canvasActions';

export type { CanvasState, CanvasAction, MemberWithPersonaInfo, StickyNote };

export function useCanvasReducer() {
  const [state, dispatch] = useReducer(canvasReducer, initialCanvasState);

  // Convenience dispatchers for the most common actions
  const setSaveStatus = useCallback((status: CanvasState['saveStatus']) =>
    dispatch({ type: 'SET_SAVE_STATUS', status }), []);
  const setSelectedMember = useCallback((member: MemberWithPersonaInfo | null) =>
    dispatch({ type: 'SET_SELECTED_MEMBER', member }), []);
  const setContextMenu = useCallback((menu: CanvasState['contextMenu']) =>
    dispatch({ type: 'SET_CONTEXT_MENU', menu }), []);
  const setEdgeTooltip = useCallback((tooltip: CanvasState['edgeTooltip']) =>
    dispatch({ type: 'SET_EDGE_TOOLTIP', tooltip }), []);
  const setGhostNode = useCallback((node: Node | null) =>
    dispatch({ type: 'SET_GHOST_NODE', node }), []);
  const setReactFlowInstance = useCallback((instance: ReactFlowInstance | null) =>
    dispatch({ type: 'SET_REACT_FLOW_INSTANCE', instance }), []);

  return { state, dispatch, setSaveStatus, setSelectedMember, setContextMenu, setEdgeTooltip, setGhostNode, setReactFlowInstance };
}
