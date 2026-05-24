import { useEffect, useState, type ReactNode } from 'react';
import { useAgentStore } from '@/stores/agentStore';
import { usePipelineStore } from '@/stores/pipelineStore';
import type { PersonaTrigger } from '@/lib/bindings/PersonaTrigger';
import type { PersonaEvent } from '@/lib/bindings/PersonaEvent';
import { listEvents } from '@/api/overview/events';
import { UnifiedRoutingView } from './layouts/UnifiedRoutingView';

interface Props {
  allTriggers: PersonaTrigger[];
  /** Slot for content rendered into the page-level ContentHeader. */
  setHeaderExtra?: (node: ReactNode) => void;
}

export function EventCanvas({ allTriggers: initialTriggers, setHeaderExtra }: Props) {
  const personas = useAgentStore(s => s.personas);
  const teams = usePipelineStore(s => s.teams);
  const fetchTeams = usePipelineStore(s => s.fetchTeams);
  const [triggers, setTriggers] = useState<PersonaTrigger[]>(initialTriggers);
  const [recentEvents, setRecentEvents] = useState<PersonaEvent[]>([]);

  useEffect(() => { setTriggers(initialTriggers); }, [initialTriggers]);

  // Load teams once so the Add-Persona modal can group personas by workspace.
  useEffect(() => { void fetchTeams(); }, [fetchTeams]);

  // Load recently emitted events to discover all event types in the bus —
  // including ones with no current listener (e.g. 'test_event_created').
  useEffect(() => {
    let stale = false;
    listEvents(1000)
      .then(events => { if (!stale) setRecentEvents(events); })
      .catch(() => { /* non-critical */ });
    return () => { stale = true; };
  }, []);

  return (
    <UnifiedRoutingView
      initialTriggers={triggers}
      initialEvents={recentEvents}
      personas={personas}
      teams={teams}
      setHeaderExtra={setHeaderExtra}
    />
  );
}
