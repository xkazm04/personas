import { useMemo } from 'react';
import { useDraggable } from '@dnd-kit/core';
import { getConnectorMeta, ConnectorIcon } from '@/features/shared/components/display/ConnectorMeta';
import { useAgentStore } from "@/stores/agentStore";
import { formatRelativeTime } from '@/lib/utils/formatters';
import { extractConnectorNames } from '@/lib/personas/utils';
import { useOnboardingScore } from '@/features/agents/components/onboarding/useOnboardingChecklist';
import { SidebarScoreRing } from '@/features/agents/components/onboarding/OnboardingChecklist';
import type { Persona } from '@/lib/types/types';
import type { DragPayload } from '@/lib/types/frontendTypes';

export function SidebarPersonaCard({
  persona,
  isSelected,
  onClick,
  onContextMenu,
}: {
  persona: Persona;
  isSelected: boolean;
  onClick: () => void;
  onContextMenu?: (e: React.MouseEvent) => void;
}) {
  const triggerCount = useAgentStore((s) => s.personaTriggerCounts[persona.id]);
  const lastRun = useAgentStore((s) => s.personaLastRun[persona.id]);
  const health = useAgentStore((s) => s.personaHealthMap[persona.id]);
  const connectors = useMemo(() => extractConnectorNames(persona), [persona]);
  const onboardingScore = useOnboardingScore(persona.id);

  // Health indicator color
  const healthColor = health?.status === 'failing' ? 'bg-red-400'
    : health?.status === 'degraded' ? 'bg-amber-400'
    : health?.status === 'healthy' ? 'bg-emerald-400'
    : 'bg-muted-foreground/30';

  return (
    <button
      onClick={onClick}
      onContextMenu={onContextMenu}
      className={`w-full text-left px-3 py-1.5 rounded-xl transition-all mb-0.5 ${
        isSelected
          ? 'bg-primary/10 border border-primary/20 border-l-2 border-l-primary'
          : 'border border-transparent border-l-2 border-l-transparent hover:bg-primary/5'
      }`}
    >
      {/* Connector icons row */}
      {connectors.length > 0 && (
        <div className="flex items-center gap-1 mb-0.5">
          {connectors.map((name) => {
            const meta = getConnectorMeta(name);
            return (
              <div
                key={name}
                className="w-4 h-4 rounded flex items-center justify-center"
                style={{ backgroundColor: `${meta.color}15` }}
              >
                <ConnectorIcon meta={meta} size="w-3 h-3" />
              </div>
            );
          })}
        </div>
      )}

      {/* Name + status */}
      <div className="flex items-center gap-1.5">
        <span className={`text-sm font-medium truncate flex-1 ${
          isSelected ? 'text-foreground' : 'text-muted-foreground/90'
        }`} title={persona.name}>
          {persona.name}
        </span>
        <SidebarScoreRing score={onboardingScore} />
        <div
          className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${
            persona.enabled ? healthColor : 'bg-muted-foreground/30'
          }`}
          title={persona.enabled ? (health?.status ?? 'unknown') : 'disabled'}
        />
        <span className="sr-only">{persona.enabled ? 'Active' : 'Inactive'}</span>
      </div>

      {/* Trigger count + last run badges */}
      {(triggerCount != null && triggerCount > 0 || lastRun) && (
        <div className="flex items-center gap-2 mt-0.5">
          {triggerCount != null && triggerCount > 0 && (
            <span className="text-sm font-mono text-muted-foreground/80">
              {triggerCount} trigger{triggerCount !== 1 ? 's' : ''}
            </span>
          )}
          {persona.enabled && lastRun && (
            <span className="text-sm text-muted-foreground/80">
              {formatRelativeTime(lastRun)}
            </span>
          )}
        </div>
      )}
    </button>
  );
}

export function DraggablePersonaCard({
  persona,
  isSelected,
  onClick,
  onContextMenu,
}: {
  persona: Persona;
  isSelected: boolean;
  onClick: () => void;
  onContextMenu?: (e: React.MouseEvent) => void;
}) {
  const dragData: DragPayload = { type: 'persona', personaId: persona.id };
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({
    id: persona.id,
    data: dragData,
  });

  const style = transform
    ? { transform: `translate(${transform.x}px, ${transform.y}px)`, zIndex: 50 }
    : undefined;

  return (
    <div
      ref={setNodeRef}
      style={style}
      {...listeners}
      {...attributes}
      className={isDragging ? 'opacity-30' : ''}
    >
      <SidebarPersonaCard persona={persona} isSelected={isSelected} onClick={onClick} onContextMenu={onContextMenu} />
    </div>
  );
}
