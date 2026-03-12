import { useDroppable } from '@dnd-kit/core';
import { DraggablePersonaCard } from './DraggablePersonaCard';
import type { DbPersona } from '@/lib/types/types';
import type { DropPayload } from '@/lib/types/frontendTypes';

interface UngroupedZoneProps {
  ungrouped: DbPersona[];
  groupsLength: number;
  activeId: string | null;
  selectedPersonaId: string | null;
  selectPersona: (id: string | null) => void;
  handleContextMenu: (e: React.MouseEvent, persona: DbPersona) => void;
}

export function UngroupedZone({
  ungrouped,
  groupsLength,
  activeId,
  selectedPersonaId,
  selectPersona,
  handleContextMenu,
}: UngroupedZoneProps) {
  const dropData: DropPayload = { type: 'ungrouped' };
  const { isOver, setNodeRef } = useDroppable({
    id: 'ungrouped',
    data: dropData,
  });

  return (
    <div
      ref={setNodeRef}
      className={`rounded-xl border transition-all ${
        isOver && activeId
          ? 'border-primary/30 bg-primary/5'
          : 'border-transparent'
      }`}
    >
      {ungrouped.length > 0 && (
        <div className="px-0.5 py-1">
          <div className="text-sm font-mono text-muted-foreground/80 uppercase tracking-wider px-2 mb-1">
            Ungrouped
          </div>
          {ungrouped.map((persona) => (
            <DraggablePersonaCard
              key={persona.id}
              persona={persona}
              isSelected={selectedPersonaId === persona.id}
              onClick={() => selectPersona(persona.id)}
              onContextMenu={(e) => handleContextMenu(e, persona)}
            />
          ))}
        </div>
      )}
      {ungrouped.length === 0 && groupsLength > 0 && activeId && (
        <div className="text-center py-3 text-sm text-muted-foreground/80 border border-dashed border-primary/20 rounded-lg">
          Drop here to ungroup
        </div>
      )}
    </div>
  );
}
