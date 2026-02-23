import { useMemo } from 'react';
import { useDraggable } from '@dnd-kit/core';
import { getConnectorMeta, ConnectorIcon } from '@/features/shared/components/ConnectorMeta';
import { usePersonaStore } from '@/stores/personaStore';
import { formatRelativeTime } from '@/lib/utils/formatters';
import { extractConnectorNames } from '@/lib/personas/utils';
import type { DbPersona } from '@/lib/types/types';

export function SidebarPersonaCard({
  persona,
  isSelected,
  onClick,
  onContextMenu,
}: {
  persona: DbPersona;
  isSelected: boolean;
  onClick: () => void;
  onContextMenu?: (e: React.MouseEvent) => void;
}) {
  const triggerCount = usePersonaStore((s) => s.personaTriggerCounts[persona.id]);
  const lastRun = usePersonaStore((s) => s.personaLastRun[persona.id]);
  const connectors = useMemo(() => extractConnectorNames(persona), [persona]);

  return (
    <button
      onClick={onClick}
      onContextMenu={onContextMenu}
      className={`w-full text-left px-3 py-1.5 rounded-lg transition-all mb-0.5 ${
        isSelected
          ? 'bg-primary/10 border-l-2 border-l-primary border-y border-r border-y-primary/20 border-r-primary/20'
          : 'border-l-2 border-transparent hover:bg-primary/5'
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
        }`}>
          {persona.name}
        </span>
        <div
          className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${
            persona.enabled ? 'bg-emerald-400' : 'bg-muted-foreground/30'
          }`}
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
  persona: DbPersona;
  isSelected: boolean;
  onClick: () => void;
  onContextMenu?: (e: React.MouseEvent) => void;
}) {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({
    id: persona.id,
    data: { type: 'persona', persona },
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
