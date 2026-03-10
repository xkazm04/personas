import type { DbPersonaExecution } from '@/lib/types/types';
import { InspectorTabs } from './InspectorTabs';

interface ExecutionInspectorProps {
  execution: DbPersonaExecution;
}

export function ExecutionInspector({ execution }: ExecutionInspectorProps) {
  return <InspectorTabs execution={execution} />;
}
