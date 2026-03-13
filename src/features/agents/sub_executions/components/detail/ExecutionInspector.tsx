import type { PersonaExecution } from '@/lib/types/types';
import { InspectorTabs } from './InspectorTabs';

interface ExecutionInspectorProps {
  execution: PersonaExecution;
}

export function ExecutionInspector({ execution }: ExecutionInspectorProps) {
  return <InspectorTabs execution={execution} />;
}
