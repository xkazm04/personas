import { useCallback, useRef } from 'react';
import { usePersonaStore } from '@/stores/personaStore';
import { useCanvasDragRef } from '@/features/pipeline/sub_canvas';
import type { useCanvasReducer } from '@/features/pipeline/sub_canvas';
import { snapToGrid } from './useCanvasHandlers';

type CanvasReducerReturn = ReturnType<typeof useCanvasReducer>;

interface UseCanvasDragDropArgs {
  cs: CanvasReducerReturn['state'];
  setGhostNode: CanvasReducerReturn['setGhostNode'];
}

export function useCanvasDragDrop({ cs, setGhostNode }: UseCanvasDragDropArgs) {
  const canvasDragRef = useCanvasDragRef();
  const lastGhostPos = useRef({ x: 0, y: 0 });

  const personas = usePersonaStore((s) => s.personas);
  const addTeamMember = usePersonaStore((s) => s.addTeamMember);

  const onCanvasDragOver = useCallback((e: React.DragEvent) => {
    if (!e.dataTransfer.types.includes('application/persona-id')) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
    if (!cs.reactFlowInstance) return;
    const position = cs.reactFlowInstance.screenToFlowPosition({ x: e.clientX, y: e.clientY });
    const x = snapToGrid(position.x), y = snapToGrid(position.y);
    if (x === lastGhostPos.current.x && y === lastGhostPos.current.y) return;
    lastGhostPos.current = { x, y };
    const personaId = canvasDragRef.current;
    const persona = personaId ? personas.find((p) => p.id === personaId) : null;
    setGhostNode({
      id: '__ghost-drop__', type: 'persona', position: { x, y },
      data: {
        name: persona?.name || 'Agent', icon: persona?.icon || '',
        color: persona?.color || '#6366f1', role: 'worker',
        memberId: '__ghost-drop__', personaId: personaId || '', isGhost: true,
      },
      draggable: false, selectable: false, connectable: false, focusable: false,
    });
  }, [cs.reactFlowInstance, personas, setGhostNode, canvasDragRef]);

  const onCanvasDragLeave = useCallback((e: React.DragEvent) => {
    const related = e.relatedTarget as HTMLElement | null;
    if (!related || !e.currentTarget.contains(related)) {
      setGhostNode(null);
      lastGhostPos.current = { x: 0, y: 0 };
    }
  }, [setGhostNode]);

  const onCanvasDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setGhostNode(null);
    lastGhostPos.current = { x: 0, y: 0 };
    const personaId = e.dataTransfer.getData('application/persona-id');
    if (!personaId || !cs.reactFlowInstance) return;
    const position = cs.reactFlowInstance.screenToFlowPosition({ x: e.clientX, y: e.clientY });
    addTeamMember(personaId, 'worker', snapToGrid(position.x), snapToGrid(position.y));
  }, [cs.reactFlowInstance, addTeamMember, setGhostNode]);

  return { onCanvasDragOver, onCanvasDragLeave, onCanvasDrop };
}
