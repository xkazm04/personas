import { useState, useCallback } from 'react';
import { startCredentialDesign, cancelCredentialDesign } from '@/api/tauriApi';
import { usePersonaStore } from '@/stores/personaStore';
import { useTauriStream } from './useTauriStream';

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

const getLine = (payload: Record<string, unknown>) => payload.line as string;

const resolveStatus = (payload: Record<string, unknown>) => {
  const status = payload.status as string;
  if (status === 'completed' && payload.result) {
    return { result: payload.result as CredentialDesignResult };
  }
  if (status === 'failed') {
    return { error: (payload.error as string) || 'Credential design failed' };
  }
  return null;
};

export function useCredentialDesign() {
  const [savedCredentialId, setSavedCredentialId] = useState<string | null>(null);

  const createConnectorDefinition = usePersonaStore((s) => s.createConnectorDefinition);
  const createCredential = usePersonaStore((s) => s.createCredential);

  const stream = useTauriStream<CredentialDesignResult>({
    progressEvent: 'credential-design-output',
    statusEvent: 'credential-design-status',
    getLine,
    resolveStatus,
    completedPhase: 'preview',
    runningPhase: 'analyzing',
    startErrorMessage: 'Failed to start credential design',
  });

  const start = useCallback(async (instruction: string) => {
    await stream.start(() => startCredentialDesign(instruction));
  }, [stream.start]);

  const cancel = useCallback(() => {
    stream.cancel(() => cancelCredentialDesign());
  }, [stream.cancel]);

  const save = useCallback(async (
    credentialName: string,
    fieldValues: Record<string, string>,
    healthcheckOverride?: Record<string, unknown> | null,
  ) => {
    if (!stream.result) return;

    stream.setPhase('saving');
    try {
      // Create connector definition if it doesn't already exist
      if (!stream.result.match_existing) {
        const conn = stream.result.connector;
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
            setup_instructions: stream.result.setup_instructions,
            summary: stream.result.summary,
          }),
          is_builtin: false,
        });
      }

      // Create the credential
      const serviceType = stream.result.match_existing || stream.result.connector.name;
      const credId = await createCredential({
        name: credentialName,
        service_type: serviceType,
        data: fieldValues,
      });

      setSavedCredentialId(credId ?? null);
      stream.setPhase('done');
    } catch (err) {
      stream.setError(err instanceof Error ? err.message : 'Failed to save credential');
      stream.setPhase('preview');
    }
  }, [stream.result, stream.setPhase, stream.setError, createConnectorDefinition, createCredential]);

  const reset = useCallback(() => {
    stream.reset();
    setSavedCredentialId(null);
  }, [stream.reset]);

  const loadTemplate = useCallback((template: CredentialDesignResult) => {
    stream.cleanup();
    stream.setLines([]);
    stream.setError(null);
    stream.setResult(template);
    stream.setPhase('preview');
  }, [stream.cleanup, stream.setLines, stream.setError, stream.setResult, stream.setPhase]);

  return {
    phase: stream.phase as CredentialDesignPhase,
    outputLines: stream.lines,
    result: stream.result,
    error: stream.error,
    savedCredentialId,
    start,
    cancel,
    save,
    reset,
    loadTemplate,
  };
}
