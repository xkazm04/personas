import { useMemo } from 'react';
import {
  ReactFlow,
  Background,
  MiniMap,
  Controls,
  type Edge,
  type Node,
  type NodeChange,
  type Connection,
  type EdgeChange,
  type ReactFlowInstance,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import {
  PersonaNode,
  StickyNoteNode,
  ConnectionEdge,
  GhostEdge,
  AlignmentGuides,
  ConnectionLegend,
} from '@/features/pipeline/sub_canvas';
import type { AlignmentLine } from '@/features/pipeline/sub_canvas';
import { GRID_SIZE } from './useCanvasHandlers';

const nodeTypes = { persona: PersonaNode, stickyNote: StickyNoteNode };
const edgeTypes = { connection: ConnectionEdge, ghost: GhostEdge };

interface CanvasFlowLayerProps {
  nodes: Node[];
  edges: Edge[];
  ghostNode: Node | null;
  alignmentLines: AlignmentLine[];
  isDraggingNode: boolean;
  onInit: (instance: ReactFlowInstance | null) => void;
  onNodesChange: (changes: NodeChange<Node>[]) => void;
  onEdgesChange: (changes: EdgeChange<Edge>[]) => void;
  onConnect: (connection: Connection) => void;
  isValidConnection: (connection: Edge | Connection) => boolean;
  onNodeClick: (event: React.MouseEvent, node: Node) => void;
  onEdgeClick: (event: React.MouseEvent, edge: Edge) => void;
  onNodeDrag: (event: React.MouseEvent, node: Node) => void;
  onNodeDragStop: () => void;
  onNodeContextMenu: (event: React.MouseEvent, node: Node) => void;
  onPaneClick: () => void;
}

export default function CanvasFlowLayer({
  nodes, edges, ghostNode, alignmentLines, isDraggingNode,
  onInit, onNodesChange, onEdgesChange, onConnect,
  isValidConnection, onNodeClick, onEdgeClick,
  onNodeDrag, onNodeDragStop, onNodeContextMenu, onPaneClick,
}: CanvasFlowLayerProps) {
  const displayNodes = useMemo(() => {
    if (!ghostNode) return nodes;
    return [...nodes, ghostNode];
  }, [nodes, ghostNode]);

  return (
    <>
      <ReactFlow
        nodes={displayNodes}
        edges={edges}
        onInit={onInit}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onConnect={onConnect}
        isValidConnection={isValidConnection}
        onNodeClick={onNodeClick}
        onEdgeClick={onEdgeClick}
        onNodeDrag={onNodeDrag}
        onNodeDragStop={onNodeDragStop}
        onNodeContextMenu={onNodeContextMenu}
        onPaneClick={onPaneClick}
        nodeTypes={nodeTypes}
        edgeTypes={edgeTypes}
        snapToGrid
        snapGrid={[GRID_SIZE, GRID_SIZE]}
        fitView
        fitViewOptions={{ padding: 0.3 }}
        className="bg-background"
        defaultEdgeOptions={{ type: 'connection' }}
        proOptions={{ hideAttribution: true }}
      >
        <Background gap={24} size={1} className="opacity-30" />
        <Controls className="!bg-secondary/60 !border-primary/15 !rounded-modal !shadow-elevation-3 [&>button]:!bg-secondary/80 [&>button]:!border-primary/15 [&>button]:!text-foreground/80 [&>button:hover]:!bg-secondary [&>button:hover]:!text-foreground/90" />
        <MiniMap
          className="!bg-secondary/40 !border-primary/15 !rounded-modal"
          maskColor="rgba(0,0,0,0.3)"
          nodeColor={(n) => (n.data as Record<string, string>)?.color || '#6366f1'}
        />
        <AlignmentGuides lines={alignmentLines} isDragging={isDraggingNode} />
      </ReactFlow>
      <ConnectionLegend />
    </>
  );
}
