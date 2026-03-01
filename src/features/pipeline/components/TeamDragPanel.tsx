import { useCallback } from 'react';
import { GripVertical } from 'lucide-react';
import { usePersonaStore } from '@/stores/personaStore';
import { PersonaAvatar, canvasDragState } from '@/features/pipeline/sub_canvas/teamConstants';
import type { PersonaTeamMember } from '@/lib/bindings/PersonaTeamMember';

export default function TeamDragPanel() {
  const personas = usePersonaStore((s) => s.personas);
  const teamMembers = usePersonaStore((s) => s.teamMembers) as PersonaTeamMember[];

  const memberPersonaIds = new Set(teamMembers.map((m) => m.persona_id));

  const handleDragStart = useCallback((e: React.DragEvent, personaId: string) => {
    canvasDragState.personaId = personaId;
    e.dataTransfer.setData('application/persona-id', personaId);
    e.dataTransfer.effectAllowed = 'copy';
  }, []);

  const handleDragEnd = useCallback(() => {
    canvasDragState.personaId = null;
  }, []);

  return (
    <div>
      <div className="text-[10px] font-mono text-muted-foreground/60 uppercase tracking-widest px-1 mb-2">
        Drag to canvas
      </div>
      <div className="space-y-0.5">
        {personas.map((p) => (
          <div
            key={p.id}
            draggable
            onDragStart={(e) => handleDragStart(e, p.id)}
            onDragEnd={handleDragEnd}
            className="flex items-center gap-2 px-2 py-1.5 rounded-lg cursor-grab active:cursor-grabbing hover:bg-primary/5 transition-colors group"
          >
            <GripVertical className="w-3 h-3 text-muted-foreground/30 group-hover:text-muted-foreground/50 shrink-0" />
            <PersonaAvatar icon={p.icon} color={p.color} size="sm" />
            <span className="text-xs font-medium text-muted-foreground/90 truncate flex-1">
              {p.name}
            </span>
            {memberPersonaIds.has(p.id) && (
              <span className="text-[10px] font-mono text-emerald-400/50 shrink-0">
                added
              </span>
            )}
          </div>
        ))}
      </div>
      {personas.length === 0 && (
        <div className="text-center py-6 text-xs text-muted-foreground/60">
          No agents created yet
        </div>
      )}
    </div>
  );
}
