/**
 * Helpers and types for InlineCredentialPanel.
 */
import { getConnectorMeta } from '@/features/shared/components/display/ConnectorMeta';
import type { CredentialDesignResult } from '@/hooks/design/credential/useCredentialDesign';
import type { ConnectorDefinition } from '@/lib/types/types';
import type { RequiredConnector } from './ConnectStep';

// -- Types --------------------------------------------------------------

export type PanelMode = 'pick' | 'design-query' | 'designing' | 'manual' | 'auto';

export interface InlineCredentialPanelProps {
  connectorName: string;
  connectorDefinitions: ConnectorDefinition[];
  credentialFields?: RequiredConnector['credential_fields'];
  setupUrl?: string;
  setupInstructions?: string;
  /** Start directly in design-query mode (for custom connector flow). */
  initialMode?: 'pick' | 'design-query';
  onSetCredential: (connectorName: string, credentialId: string) => void;
  onCredentialCreated: () => void;
  onSaveSuccess?: (connectorName: string, credentialName: string) => void;
  onClose: () => void;
}

// -- Helpers ------------------------------------------------------------

export function findConnectorDefinition(
  connectorName: string,
  definitions: ConnectorDefinition[],
): ConnectorDefinition | undefined {
  return definitions.find((d) => d.name === connectorName);
}

/** Build a synthetic CredentialDesignResult from known connector data. */
export function buildSyntheticDesignResult(
  connectorName: string,
  connectorDef: ConnectorDefinition | undefined,
  credentialFields?: RequiredConnector['credential_fields'],
  setupInstructions?: string,
): CredentialDesignResult | null {
  const meta = getConnectorMeta(connectorName);

  let fields: CredentialDesignResult['connector']['fields'];

  if (connectorDef?.fields?.length) {
    fields = connectorDef.fields.map((f) => ({
      key: f.key,
      label: f.label,
      type: f.type,
      required: f.required ?? false,
      placeholder: f.placeholder,
      helpText: f.helpText,
    }));
  } else if (credentialFields?.length) {
    fields = credentialFields.map((f) => ({
      key: f.key,
      label: f.label,
      type: f.type,
      required: f.required ?? false,
      placeholder: f.placeholder,
      helpText: f.helpText,
    }));
  } else {
    return null;
  }

  return {
    match_existing: connectorDef ? connectorName : null,
    connector: {
      name: connectorName,
      label: meta.label,
      category: connectorDef?.category ?? 'custom',
      color: connectorDef?.color ?? '#888',
      fields,
      healthcheck_config: connectorDef?.healthcheck_config ?? null,
      services: [],
      events: [],
    },
    setup_instructions: setupInstructions ?? '',
    summary: `${meta.label} credential`,
  };
}
