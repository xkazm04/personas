import { useMemo } from 'react';
import { CredentialSchemaForm, MCP_SCHEMA } from './CredentialSchemaForm';
import type { ConnectorDefinition, ConnectorAuthMethod } from '@/lib/types/types';

interface McpPrefilledFormProps {
  connector: ConnectorDefinition;
  authMethod: ConnectorAuthMethod;
  onComplete: () => void;
  onCancel: () => void;
}

export function McpPrefilledForm({ connector, authMethod, onComplete, onCancel }: McpPrefilledFormProps) {
  const initialValues = useMemo<Record<string, string> | undefined>(() => {
    if (authMethod.package) return { command: `npx -y ${authMethod.package}` };
    return undefined;
  }, [authMethod.package]);

  const initialExtras = useMemo<Record<string, unknown> | undefined>(() => {
    if (authMethod.suggested_env && Object.keys(authMethod.suggested_env).length > 0) {
      return {
        env_vars: Object.entries(authMethod.suggested_env).map(([key, value]) => ({ key, value })),
      };
    }
    return undefined;
  }, [authMethod.suggested_env]);

  return (
    <CredentialSchemaForm
      config={MCP_SCHEMA}
      defaultSubType={authMethod.transport ?? 'stdio'}
      initialValues={initialValues}
      initialExtras={initialExtras}
      nameOverride={`${connector.label} MCP`}
      serviceTypeOverride={`mcp_${connector.name}`}
      showHeader={false}
      onBack={onCancel}
      onComplete={onComplete}
    />
  );
}
