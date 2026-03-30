import { useEffect, useState } from 'react';
import { useAgentStore } from '@/stores/agentStore';
import { usePipelineStore } from '@/stores/pipelineStore';
import type { PersonaTrigger } from '@/lib/bindings/PersonaTrigger';
import { UnifiedRoutingView } from './layouts/UnifiedRoutingView';

interface Props { allTriggers: PersonaTrigger[] }

export function EventCanvas({ allTriggers: initialTriggers }: Props) {
  const personas = useAgentStore(s => s.personas);
  const groups = usePipelineStore(s => s.groups);
  const [triggers, setTriggers] = useState<PersonaTrigger[]>(initialTriggers);

  useEffect(() => { setTriggers(initialTriggers); }, [initialTriggers]);

  return (
    <UnifiedRoutingView
      initialTriggers={triggers}
      personas={personas}
      groups={groups}
    />
  );
}
