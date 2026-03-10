import type { PersonaExecution } from '@/lib/bindings/PersonaExecution';

export interface ToolCallStep {
  step_index: number;
  tool_name: string;
  input_preview: string;
  output_preview: string;
  started_at_ms: number;
  ended_at_ms?: number;
  duration_ms?: number;
}

export interface ExecutionComparisonProps {
  left: PersonaExecution;
  right: PersonaExecution;
  onClose: () => void;
}
