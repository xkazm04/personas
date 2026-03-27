import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ReactFlow,
  Background,
  MiniMap,
  Controls,
  useNodesState,
  useEdgesState,
  type Node,
  type Edge,
  type Connection,
  type NodeChange,
  type EdgeChange,
  MarkerType,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { usePipelineStore } from '@/stores/pipelineStore';
import { useAgentStore } from '@/stores/agentStore';
import type { WorkflowNode, WorkflowNodeKind } from '@/lib/types/compositionTypes';
import { topologicalSort } from '@/features/composition/libs/dagUtils';
import WorkflowPersonaNode from './nodes/WorkflowPersonaNode';
import DataFlowEdge from './edges/DataFlowEdge';
import WorkflowToolbar from './WorkflowToolbar';
import PersonaPickerModal from './PersonaPickerModal';
import WorkflowExecutionPanel from './WorkflowExecutionPanel';

const nodeTypes = { workflow: WorkflowPersonaNode };
const edgeTypes = { dataflow: DataFlowEdge };

const GRID = 20;

export default function WorkflowCanvas() {
  const selectedWorkflowId = usePipelineStore((s) => s.selectedWorkflowId);
  const workflows = usePipelineStore((s) => s.workflows);
  const updateWorkflow = usePipelineStore((s) => s.updateWorkflow);
  const selectWorkflow = usePipelineStore((s) => s.selectWorkflow);
  const executeWorkflow = usePipelineStore((s) => s.executeWorkflow);
  const cancelWorkflowExecution = usePipelineStore((s) => s.cancelWorkflowExecution);
  const workflowExecution = usePipelineStore((s) => s.workflowExecution);
  const personas = useAgentStore((s) => s.personas);

  const workflow = workflows.find((w) => w.id === selectedWorkflowId);
  const [nodes, setNodes, onNodesChange] = useNodesState<Node>([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>([]);

  const [pickerOpen, setPickerOpen] = useState(false);
  const [pendingNodeId, setPendingNodeId] = useState<string | null>(null);

  const personaMap = useMemo(
    () => new Map(personas.map((p) => [p.id, p])),
    [personas],
  );

  // Sync workflow data → xyflow nodes/edges
  useEffect(() => {
    if (!workflow) return;

    const flowNodes: Node[] = workflow.nodes.map((n) => {
      const persona = n.personaId ? personaMap.get(n.personaId) : undefined;
      const execStatus = workflowExecution?.workflowId === workflow.id
        ? workflowExecution.nodeExecutions[n.id]?.status
        : undefined;

      return {
        id: n.id,
        type: 'workflow',
        position: n.position,
        data: {
          kind: n.kind,
          label: n.label,
          personaId: n.personaId,
          personaIcon: persona?.icon,
          personaColor: persona?.color,
          executionStatus: execStatus,
        },
      };
    });

    const flowEdges: Edge[] = workflow.edges.map((e) => ({
      id: e.id,
      source: e.source,
      target: e.target,
      type: 'dataflow',
      label: e.label,
      markerEnd: { type: MarkerType.ArrowClosed, width: 16, height: 16, color: '#3b82f6' },
    }));

    setNodes(flowNodes);
    setEdges(flowEdges);
  }, [workflow, personaMap, workflowExecution, setNodes, setEdges]);

  // Persist node position changes
  const handleNodesChange = useCallback(
    (changes: NodeChange<Node>[]) => {
      onNodesChange(changes);

      if (!workflow) return;
      const posChanges = changes.filter(
        (c): c is NodeChange<Node> & { type: 'position'; position: { x: number; y: number }; dragging: boolean } =>
          c.type === 'position' && 'dragging' in c && !(c as { dragging?: boolean }).dragging,
      );
      if (posChanges.length === 0) return;

      const updatedNodes = workflow.nodes.map((n) => {
        const change = posChanges.find((c) => c.id === n.id);
        if (change && change.position) {
          return { ...n, position: change.position };
        }
        return n;
      });
      updateWorkflow(workflow.id, { nodes: updatedNodes });
    },
    [onNodesChange, workflow, updateWorkflow],
  );

  // Handle new connections (validate DAG)
  const handleConnect = useCallback(
    (connection: Connection) => {
      if (!workflow || !connection.source || !connection.target) return;
      if (connection.source === connection.target) return;

      // Check if adding this edge would create a cycle
      const testEdges = [...workflow.edges, {
        id: `e-${connection.source}-${connection.target}`,
        source: connection.source,
        target: connection.target,
      }];
      const { hasCycle } = topologicalSort(workflow.nodes, testEdges);
      if (hasCycle) return; // Reject cyclic edge

      const newEdge = {
        id: crypto.randomUUID(),
        source: connection.source,
        target: connection.target,
      };
      updateWorkflow(workflow.id, { edges: [...workflow.edges, newEdge] });
    },
    [workflow, updateWorkflow],
  );

  // Delete edges
  const handleEdgesChange = useCallback(
    (changes: EdgeChange<Edge>[]) => {
      onEdgesChange(changes);

      if (!workflow) return;
      const removals = changes.filter((c) => c.type === 'remove').map((c) => c.id);
      if (removals.length === 0) return;

      updateWorkflow(workflow.id, {
        edges: workflow.edges.filter((e) => !removals.includes(e.id)),
      });
    },
    [onEdgesChange, workflow, updateWorkflow],
  );

  // Validate connections: reject cycles and self-loops
  const isValidConnection = useCallback(
    (connection: Edge | Connection) => {
      if (!workflow || !connection.source || !connection.target) return false;
      if (connection.source === connection.target) return false;

      const testEdges = [...workflow.edges, {
        id: 'test',
        source: connection.source,
        target: connection.target,
      }];
      return !topologicalSort(workflow.nodes, testEdges).hasCycle;
    },
    [workflow],
  );

  // Add node helpers
  const addNode = useCallback(
    (kind: WorkflowNodeKind) => {
      if (!workflow) return;
      const id = crypto.randomUUID();
      const nodeCount = workflow.nodes.length;
      const newNode: WorkflowNode = {
        id,
        kind,
        label: kind === 'input' ? 'Input' : kind === 'output' ? 'Output' : 'New Persona',
        position: { x: 250 + (nodeCount % 4) * 200, y: 100 + Math.floor(nodeCount / 4) * 150 },
      };

      if (kind === 'persona') {
        setPendingNodeId(id);
        setPickerOpen(true);
        // Add node immediately, persona will be assigned via picker
        updateWorkflow(workflow.id, { nodes: [...workflow.nodes, newNode] });
      } else {
        updateWorkflow(workflow.id, { nodes: [...workflow.nodes, newNode] });
      }
    },
    [workflow, updateWorkflow],
  );

  const handlePersonaSelect = useCallback(
    (personaId: string, name: string, _icon?: string, _color?: string) => {
      if (!workflow || !pendingNodeId) return;
      updateWorkflow(workflow.id, {
        nodes: workflow.nodes.map((n) =>
          n.id === pendingNodeId ? { ...n, personaId, label: name } : n,
        ),
      });
      setPendingNodeId(null);
      setPickerOpen(false);
    },
    [workflow, pendingNodeId, updateWorkflow],
  );

  // Delete selected nodes via keyboard
  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (!workflow) return;
      if (e.key === 'Delete' || e.key === 'Backspace') {
        const selectedNodeIds = nodes.filter((n) => n.selected).map((n) => n.id);
        const selectedEdgeIds = edges.filter((e) => e.selected).map((e) => e.id);
        if (selectedNodeIds.length === 0 && selectedEdgeIds.length === 0) return;

        updateWorkflow(workflow.id, {
          nodes: workflow.nodes.filter((n) => !selectedNodeIds.includes(n.id)),
          edges: workflow.edges.filter(
            (e) =>
              !selectedEdgeIds.includes(e.id) &&
              !selectedNodeIds.includes(e.source) &&
              !selectedNodeIds.includes(e.target),
          ),
        });
      }
    },
    [workflow, nodes, edges, updateWorkflow],
  );

  const isExecuting = workflowExecution?.status === 'running' && workflowExecution.workflowId === workflow?.id;

  if (!workflow) return null;

  return (
    <div className="flex flex-col h-full" onKeyDown={handleKeyDown} tabIndex={0}>
      <WorkflowToolbar
        workflowName={workflow.name}
        isExecuting={isExecuting}
        onBack={() => selectWorkflow(null)}
        onAddPersonaNode={() => addNode('persona')}
        onAddInputNode={() => addNode('input')}
        onAddOutputNode={() => addNode('output')}
        onExecute={() => executeWorkflow(workflow.id)}
        onCancel={cancelWorkflowExecution}
      />

      <div className="flex-1 relative">
        <ReactFlow
          nodes={nodes}
          edges={edges}
          onNodesChange={handleNodesChange}
          onEdgesChange={handleEdgesChange}
          onConnect={handleConnect}
          isValidConnection={isValidConnection}
          nodeTypes={nodeTypes}
          edgeTypes={edgeTypes}
          snapToGrid
          snapGrid={[GRID, GRID]}
          fitView
          fitViewOptions={{ padding: 0.3 }}
          className="bg-background"
          defaultEdgeOptions={{ type: 'dataflow', markerEnd: { type: MarkerType.ArrowClosed, width: 16, height: 16, color: '#3b82f6' } }}
          proOptions={{ hideAttribution: true }}
          deleteKeyCode={null}
        >
          <Background gap={24} size={1} className="opacity-30" />
          <Controls className="!bg-secondary/60 !border-primary/15 !rounded-xl !shadow-elevation-3 [&>button]:!bg-secondary/80 [&>button]:!border-primary/15 [&>button]:!text-foreground/80 [&>button:hover]:!bg-secondary [&>button:hover]:!text-foreground/90" />
          <MiniMap
            className="!bg-secondary/40 !border-primary/15 !rounded-xl"
            maskColor="rgba(0,0,0,0.3)"
            nodeColor={() => '#6366f1'}
          />
        </ReactFlow>

        {/* Execution results panel */}
        {workflowExecution && workflowExecution.workflowId === workflow.id && (
          <WorkflowExecutionPanel execution={workflowExecution} nodes={workflow.nodes} />
        )}
      </div>

      {/* Persona picker modal */}
      <PersonaPickerModal
        open={pickerOpen}
        onClose={() => { setPickerOpen(false); setPendingNodeId(null); }}
        onSelect={handlePersonaSelect}
      />
    </div>
  );
}
