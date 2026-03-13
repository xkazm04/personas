import type { DragPayload, DropPayload } from '@/lib/types/frontendTypes';
import type { Persona } from '@/lib/types/types';

export const GROUP_COLORS = [
  '#6B7280', '#3B82F6', '#8B5CF6', '#EC4899', '#EF4444',
  '#F59E0B', '#10B981', '#06B6D4', '#6366F1', '#F97316',
];

export function getDragPayload(event: { active: { data: { current?: Record<string, unknown> } } }): DragPayload | null {
  return (event.active.data.current as DragPayload) ?? null;
}

export function getDropPayload(event: { over: { data: { current?: Record<string, unknown> } } | null }): DropPayload | null {
  if (!event.over) return null;
  return (event.over.data.current as DropPayload) ?? null;
}

/** Resolve a drop payload to a target group ID (or null for ungrouped). */
export function resolveDropGroupId(drop: DropPayload, personas: Persona[]): string | null {
  switch (drop.type) {
    case 'group': return drop.groupId;
    case 'group-reorder': return drop.groupId;
    case 'ungrouped': return null;
    case 'persona': {
      const target = personas.find(p => p.id === drop.personaId);
      return target?.group_id || null;
    }
    default:
      return null;
  }
}
