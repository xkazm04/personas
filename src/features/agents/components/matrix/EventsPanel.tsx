import { useState, useEffect } from 'react';
import { Check, Radio } from 'lucide-react';
import { PersonaIcon } from '@/features/shared/components/display/PersonaIcon';
import { useAgentStore } from '@/stores/agentStore';
import { getPersonaDetail } from '@/api/agents/personas';
import type { PersonaTrigger } from '@/lib/bindings/PersonaTrigger';
import type { EventSubscription } from './quickConfigTypes';

interface EventsPanelProps {
  selectedEvents: EventSubscription[];
  onToggleEvent: (event: EventSubscription) => void;
}

export function EventsPanel({
  selectedEvents,
  onToggleEvent,
}: EventsPanelProps) {
  const personas = useAgentStore((s) => s.personas);
  const [selectedPersonaId, setSelectedPersonaId] = useState<string | null>(null);
  const [triggers, setTriggers] = useState<PersonaTrigger[]>([]);
  const [loading, setLoading] = useState(false);
  const [designEvents, setDesignEvents] = useState<Array<{ event_type: string; description?: string }>>([]);

  useEffect(() => {
    if (!selectedPersonaId) { setTriggers([]); setDesignEvents([]); return; }
    setLoading(true);
    getPersonaDetail(selectedPersonaId)
      .then((detail) => {
        const eventTriggers = (detail.triggers ?? []).filter(
          (t: PersonaTrigger) => t.trigger_type === 'event_listener' && t.enabled,
        );
        setTriggers(eventTriggers);

        try {
          const dr = (detail as unknown as Record<string, unknown>).last_design_result;
          if (typeof dr === 'string') {
            const parsed = JSON.parse(dr) as Record<string, unknown>;
            const subs = (parsed.suggested_event_subscriptions ?? []) as Array<{ event_type?: string; description?: string }>;
            setDesignEvents(subs.filter((s) => s.event_type).map((s) => ({ event_type: s.event_type!, description: s.description })));
          } else {
            setDesignEvents([]);
          }
        } catch { setDesignEvents([]); }
      })
      .catch(() => { setTriggers([]); setDesignEvents([]); })
      .finally(() => setLoading(false));
  }, [selectedPersonaId]);

  const selectedPersona = selectedPersonaId ? personas.find((p) => p.id === selectedPersonaId) : null;

  return (
    <div className="flex gap-6 px-1">
      {/* Persona selector (left) */}
      <div className="flex flex-col gap-2 min-w-[160px]">
        <span className="text-[10px] font-semibold text-muted-foreground/50 uppercase tracking-wider">Source Agent</span>
        <div className="flex flex-col gap-1 overflow-y-auto">
          {personas.filter((p) => p.enabled).map((p) => (
            <button
              key={p.id}
              type="button"
              onClick={() => setSelectedPersonaId(p.id === selectedPersonaId ? null : p.id)}
              className={`flex items-center gap-2 px-2.5 py-1.5 rounded-lg text-left transition-all duration-200 ${
                selectedPersonaId === p.id
                  ? 'bg-primary/10 border border-primary/25'
                  : 'hover:bg-secondary/30 border border-transparent'
              }`}
            >
              <PersonaIcon icon={p.icon} color={p.color} />
              <span className={`text-xs truncate ${selectedPersonaId === p.id ? 'text-primary font-medium' : 'text-muted-foreground/60'}`}>
                {p.name}
              </span>
            </button>
          ))}
          {personas.filter((p) => p.enabled).length === 0 && (
            <p className="text-xs text-muted-foreground/40 py-2">No agents available</p>
          )}
        </div>
      </div>

      {/* Event triggers (right) */}
      <div className="flex-1 flex flex-col gap-2">
        <span className="text-[10px] font-semibold text-muted-foreground/50 uppercase tracking-wider">
          {selectedPersona ? `Events from ${selectedPersona.name}` : 'Select an agent'}
        </span>
        {loading ? (
          <p className="text-xs text-muted-foreground/40 py-2 animate-pulse">Loading events...</p>
        ) : designEvents.length === 0 && triggers.length === 0 ? (
          <p className="text-xs text-muted-foreground/40 py-2">
            {selectedPersonaId ? 'No event subscriptions found' : 'Choose an agent to see its events'}
          </p>
        ) : (
          <div className="flex flex-col gap-1 overflow-y-auto">
            {designEvents.map((de) => {
              const stableId = `design:${de.event_type}`;
              const isSelected = selectedEvents.some((e) => e.triggerId === stableId);
              const event: EventSubscription = {
                personaId: selectedPersonaId!,
                personaName: selectedPersona?.name ?? 'Agent',
                triggerId: stableId,
                description: de.event_type,
              };
              return (
                <button
                  key={stableId}
                  type="button"
                  onClick={() => onToggleEvent(event)}
                  className={`flex items-center gap-2.5 px-3 py-2 rounded-lg text-left transition-all duration-200 ${
                    isSelected
                      ? 'bg-teal-500/10 border border-teal-500/25'
                      : 'bg-secondary/10 border border-transparent hover:border-primary/15'
                  }`}
                >
                  <Radio className={`w-3.5 h-3.5 flex-shrink-0 ${isSelected ? 'text-teal-400' : 'text-muted-foreground/40'}`} />
                  <div className="min-w-0 flex-1">
                    <span className={`text-xs font-mono block truncate ${isSelected ? 'text-teal-300 font-medium' : 'text-muted-foreground/70'}`}>
                      {de.event_type}
                    </span>
                    {de.description && (
                      <span className="text-[10px] text-muted-foreground/40 block truncate">{de.description}</span>
                    )}
                  </div>
                  {isSelected && (
                    <Check className="w-3 h-3 ml-auto text-teal-400 flex-shrink-0" />
                  )}
                </button>
              );
            })}
            {designEvents.length === 0 && triggers.map((t) => {
              const eventLabel = (() => {
                try {
                  const cfg = t.config ? JSON.parse(t.config) as Record<string, unknown> : {};
                  if (cfg.event_type) return String(cfg.event_type);
                  if (cfg.description && String(cfg.description).length > 3) return String(cfg.description);
                } catch { /* fallback */ }
                return `${selectedPersona?.name ?? 'Agent'} event`;
              })();
              const isSelected = selectedEvents.some((e) => e.triggerId === t.id);
              const event: EventSubscription = {
                personaId: t.persona_id,
                personaName: selectedPersona?.name ?? 'Agent',
                triggerId: t.id,
                description: eventLabel,
              };
              return (
                <button
                  key={t.id}
                  type="button"
                  onClick={() => onToggleEvent(event)}
                  className={`flex items-center gap-2.5 px-3 py-2 rounded-lg text-left transition-all duration-200 ${
                    isSelected
                      ? 'bg-teal-500/10 border border-teal-500/25'
                      : 'bg-secondary/10 border border-transparent hover:border-primary/15'
                  }`}
                >
                  <Radio className={`w-3.5 h-3.5 flex-shrink-0 ${isSelected ? 'text-teal-400' : 'text-muted-foreground/40'}`} />
                  <span className={`text-xs font-mono ${isSelected ? 'text-teal-300 font-medium' : 'text-muted-foreground/60'}`}>
                    {eventLabel}
                  </span>
                  {isSelected && (
                    <Check className="w-3 h-3 ml-auto text-teal-400 flex-shrink-0" />
                  )}
                </button>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
