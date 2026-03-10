// Components
export { default as AlignmentGuides, computeAlignments } from './components/AlignmentGuides';
export type { AlignmentLine } from './components/AlignmentGuides';
export { default as CanvasAssistant } from './components/assistant/CanvasAssistant';
export { default as ConnectionEdge } from './components/edges/ConnectionEdge';
export { default as ConnectionLegend } from './components/edges/ConnectionLegend';
export { default as DryRunDebugger } from './components/debugger/DryRunDebugger';
export type { DryRunState, DryRunNodeData } from './libs/debuggerTypes';
export { default as EdgeDeleteTooltip } from './components/edges/EdgeDeleteTooltip';
export { default as GhostEdge } from './components/edges/GhostEdge';
export { default as NodeContextMenu } from './components/nodes/NodeContextMenu';
export { default as OptimizerPanel } from './components/OptimizerPanel';
export { default as PersonaNode } from './components/nodes/PersonaNode';
export { default as PipelineControls } from './components/PipelineControls';
export { default as StickyNoteNode } from './components/nodes/StickyNoteNode';
export type { StickyNoteCategory } from './components/nodes/StickyNoteNode';
export { default as TeamToolbar } from './components/TeamToolbar';

// Libs
export { CanvasDragProvider, useCanvasDragRef } from './libs/CanvasDragContext';
export { buildTeamGraph } from './libs/teamGraph';
export type { TeamGraph } from './libs/teamGraph';
export {
  TEAM_ROLES,
  ROLE_COLORS,
  PersonaAvatar,
  CONNECTION_TYPE_STYLES,
  DEFAULT_CONNECTION_STYLE,
  getConnectionStyle,
} from './libs/teamConstants';
export type { ConnectionTypeStyle } from './libs/teamConstants';
export { useCanvasReducer } from './libs/useCanvasReducer';
export type { CanvasState, CanvasAction, MemberWithPersonaInfo, StickyNote } from './libs/canvasActions';
export { useDerivedCanvasState } from './libs/useDerivedCanvasState';
export type { PipelineNodeStatus } from './libs/useDerivedCanvasState';
