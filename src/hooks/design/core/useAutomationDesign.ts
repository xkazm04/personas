import { startAutomationDesign, cancelAutomationDesign } from '@/api/agents/automations';
import { useAiArtifactTask } from './useAiArtifactTask';
import { EventName } from '@/lib/eventRegistry';

export type AutomationDesignPhase = 'idle' | 'analyzing' | 'preview' | 'error';

export interface AutomationDesignResult {
  name: string;
  description: string;
  platform: 'n8n' | 'github_actions' | 'zapier' | 'custom';
  webhook_url: string;
  webhook_method: string;
  input_schema: string | null;
  output_schema: string | null;
  timeout_secs: number;
  fallback_mode: 'connector' | 'fail' | 'skip';
  platform_reasoning: string;
  setup_steps: string[];
  suggested_credential_type: string | null;
  handles_connectors: string[];
  workflow_definition: Record<string, unknown> | null;
}

export function useAutomationDesign() {
  const task = useAiArtifactTask<[string, string], AutomationDesignResult>({
    progressEvent: 'automation-design-output',
    statusEvent: EventName.AUTOMATION_DESIGN_STATUS,
    runningPhase: 'analyzing',
    completedPhase: 'preview',
    startFn: startAutomationDesign,
    cancelFn: cancelAutomationDesign,
    errorMessage: 'Automation design failed',
    traceOperation: 'automation_design',
  });

  return {
    phase: task.phase as AutomationDesignPhase,
    outputLines: task.lines,
    result: task.result,
    error: task.error,
    start: task.start,
    cancel: task.cancel,
    reset: task.reset,
    setResult: task.setResult,
    setPhase: task.setPhase,
    setError: task.setError,
  };
}
