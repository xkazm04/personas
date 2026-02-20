import { useMemo } from 'react';
import { getConnectorMeta, ConnectorIcon } from '@/features/shared/components/ConnectorMeta';
import { usePersonaStore } from '@/stores/personaStore';
import { formatRelativeTime } from '@/lib/utils/formatters';
import type { DbPersona } from '@/lib/types/types';
import type { DesignAnalysisResult } from '@/lib/types/designTypes';

interface PersonaCardProps {
  persona: DbPersona;
  isSelected: boolean;
  onClick: () => void;
}

export default function PersonaCard({ persona, isSelected, onClick }: PersonaCardProps) {
  const triggerCount = usePersonaStore((s) => s.personaTriggerCounts[persona.id]);
  const lastRun = usePersonaStore((s) => s.personaLastRun[persona.id]);

  // Extract connector names from last_design_result
  const connectors = useMemo(() => {
    if (!persona.last_design_result) return [];
    try {
      const dr = JSON.parse(persona.last_design_result) as DesignAnalysisResult;
      return (dr.suggested_connectors ?? []).map(c => typeof c === 'string' ? c : c.name).slice(0, 4);
    } catch {
      return [];
    }
  }, [persona.last_design_result]);

  return (
    <button
      onClick={onClick}
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
        <span className={`text-xs font-medium truncate flex-1 ${
          isSelected ? 'text-foreground' : 'text-muted-foreground/70'
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
            <span className="text-[10px] font-mono text-muted-foreground/30">
              {triggerCount} trigger{triggerCount !== 1 ? 's' : ''}
            </span>
          )}
          {persona.enabled && lastRun && (
            <span className="text-[10px] text-muted-foreground/30">
              {formatRelativeTime(lastRun)}
            </span>
          )}
        </div>
      )}
    </button>
  );
}
