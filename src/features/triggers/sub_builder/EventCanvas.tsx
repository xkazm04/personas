import { useEffect, useState } from 'react';
import { useAgentStore } from '@/stores/agentStore';
import { usePipelineStore } from '@/stores/pipelineStore';
import type { PersonaTrigger } from '@/lib/bindings/PersonaTrigger';
import type { PersonaEvent } from '@/lib/bindings/PersonaEvent';
import { listEvents } from '@/api/overview/events';
import { UnifiedRoutingView } from './layouts/UnifiedRoutingView';

interface Props { allTriggers: PersonaTrigger[] }

export function EventCanvas({ allTriggers: initialTriggers }: Props) {
  const personas = useAgentStore(s => s.personas);
  const groups = usePipelineStore(s => s.groups);
  const [triggers, setTriggers] = useState<PersonaTrigger[]>(initialTriggers);
  const [recentEvents, setRecentEvents] = useState<PersonaEvent[]>([]);

  useEffect(() => { setTriggers(initialTriggers); }, [initialTriggers]);

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
      groups={groups}
    />
  );
}
