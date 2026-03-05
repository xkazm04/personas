import { useCallback } from 'react';
import { startAutomationDesign, cancelAutomationDesign } from '@/api/automations';
import { useAiArtifactFlow, defaultGetLine, buildResolveStatus } from './useAiArtifactFlow';

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
  const flow = useAiArtifactFlow<{ personaId: string; description: string }, AutomationDesignResult>({
    stream: {
      progressEvent: 'automation-design-output',
      statusEvent: 'automation-design-status',
      getLine: defaultGetLine,
      resolveStatus: buildResolveStatus('Automation design failed'),
      completedPhase: 'preview',
      runningPhase: 'analyzing',
      startErrorMessage: 'Failed to start automation design',
    },
    startFn: ({ personaId, description }) => startAutomationDesign(personaId, description),
  });

  const cancel = useCallback(() => {
    flow.cancel(() => cancelAutomationDesign());
  }, [flow.cancel]);

  return {
    phase: flow.phase as AutomationDesignPhase,
    outputLines: flow.lines,
    result: flow.result,
    error: flow.error,
    start: flow.start,
    cancel,
    reset: flow.reset,
    setResult: flow.setResult,
    setPhase: flow.setPhase,
    setError: flow.setError,
  };
}
