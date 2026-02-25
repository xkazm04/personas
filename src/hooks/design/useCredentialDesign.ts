import { useState, useCallback } from 'react';
import { startCredentialDesign, cancelCredentialDesign } from '@/api/tauriApi';
import { usePersonaStore } from '@/stores/personaStore';
import { useAiArtifactFlow, defaultGetLine, buildResolveStatus } from './useAiArtifactFlow';

export type CredentialDesignPhase = 'idle' | 'analyzing' | 'preview' | 'saving' | 'done' | 'error';

export interface CredentialDesignConnector {
  name: string;
  label: string;
  category: string;
  color: string;
  oauth_type?: string | null;
  fields: { key: string; label: string; type: string; required: boolean; placeholder?: string; helpText?: string }[];
  healthcheck_config: object | null;
  services: unknown[];
  events: unknown[];
}

export interface CredentialDesignResult {
  match_existing: string | null;
  connector: CredentialDesignConnector;
  setup_instructions: string;
  summary: string;
}

export function useCredentialDesign() {
  const [savedCredentialId, setSavedCredentialId] = useState<string | null>(null);

  const createConnectorDefinition = usePersonaStore((s) => s.createConnectorDefinition);
  const createCredential = usePersonaStore((s) => s.createCredential);

  const flow = useAiArtifactFlow<string, CredentialDesignResult>({
    stream: {
      progressEvent: 'credential-design-output',
      statusEvent: 'credential-design-status',
      getLine: defaultGetLine,
      resolveStatus: buildResolveStatus('Credential design failed'),
      completedPhase: 'preview',
      runningPhase: 'analyzing',
      startErrorMessage: 'Failed to start credential design',
    },
    startFn: (instruction) => startCredentialDesign(instruction),
  });

  const cancel = useCallback(() => {
    flow.cancel(() => cancelCredentialDesign());
  }, [flow.cancel]);

  const save = useCallback(async (
    credentialName: string,
    fieldValues: Record<string, string>,
    healthcheckOverride?: Record<string, unknown> | null,
  ) => {
    if (!flow.result) return;

    flow.setPhase('saving');
    try {
      // Create connector definition if it doesn't already exist
      if (!flow.result.match_existing) {
        const conn = flow.result.connector;
        await createConnectorDefinition({
          name: conn.name,
          label: conn.label,
          category: conn.category,
          color: conn.color,
          fields: JSON.stringify(conn.fields),
          healthcheck_config: JSON.stringify(healthcheckOverride ?? conn.healthcheck_config ?? null),
          services: JSON.stringify(conn.services || []),
          events: JSON.stringify(conn.events || []),
          metadata: JSON.stringify({
            template_enabled: true,
            setup_instructions: flow.result.setup_instructions,
            summary: flow.result.summary,
          }),
          is_builtin: false,
        });
      }

      // Create the credential
      const serviceType = flow.result.match_existing || flow.result.connector.name;
      const credId = await createCredential({
        name: credentialName,
        service_type: serviceType,
        data: fieldValues,
      });

      setSavedCredentialId(credId ?? null);
      flow.setPhase('done');
    } catch (err) {
      flow.setError(err instanceof Error ? err.message : 'Failed to save credential');
      flow.setPhase('preview');
    }
  }, [flow.result, flow.setPhase, flow.setError, createConnectorDefinition, createCredential]);

  const reset = useCallback(() => {
    flow.reset();
    setSavedCredentialId(null);
  }, [flow.reset]);

  const loadTemplate = useCallback((template: CredentialDesignResult) => {
    flow.cleanup();
    flow.setLines([]);
    flow.setError(null);
    flow.setResult(template);
    flow.setPhase('preview');
  }, [flow.cleanup, flow.setLines, flow.setError, flow.setResult, flow.setPhase]);

  return {
    phase: flow.phase as CredentialDesignPhase,
    outputLines: flow.lines,
    result: flow.result,
    error: flow.error,
    savedCredentialId,
    start: flow.start,
    cancel,
    save,
    reset,
    loadTemplate,
  };
}
