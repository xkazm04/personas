import { useState, useCallback } from 'react';
import type { ConnectorDefinition } from '@/lib/types/types';
import { isGoogleOAuthConnector } from '@/lib/utils/connectors';

type TemplateMode = 'pick-type' | 'add-form';

export interface TemplateSelectionState {
  templateMode: TemplateMode;
  selectedConnector: ConnectorDefinition | null;
  credentialName: string;
  templateSearch: string;
  isGoogleTemplate: boolean;
  effectiveTemplateFields: ConnectorDefinition['fields'];
  filteredConnectors: ConnectorDefinition[];
  setCredentialName: (name: string) => void;
  setTemplateSearch: (search: string) => void;
  pickType: (connector: ConnectorDefinition) => void;
  cancelForm: () => void;
  resetAll: () => void;
}

export function useTemplateSelection(connectorDefinitions: ConnectorDefinition[]): TemplateSelectionState {
  const [templateMode, setTemplateMode] = useState<TemplateMode>('pick-type');
  const [selectedConnector, setSelectedConnector] = useState<ConnectorDefinition | null>(null);
  const [credentialName, setCredentialName] = useState('');
  const [templateSearch, setTemplateSearch] = useState('');

  const isGoogleTemplate = selectedConnector ? isGoogleOAuthConnector(selectedConnector) : false;

  const effectiveTemplateFields = selectedConnector?.fields
    ? (isGoogleTemplate
      ? selectedConnector.fields.filter((f) => !['client_id', 'client_secret', 'refresh_token', 'scopes'].includes(f.key))
      : selectedConnector.fields)
    : [];

  const filteredConnectors = connectorDefinitions.filter((connector) => {
    const q = templateSearch.trim().toLowerCase();
    if (!q) return true;
    return (
      connector.label.toLowerCase().includes(q)
      || connector.name.toLowerCase().includes(q)
      || connector.category.toLowerCase().includes(q)
    );
  });

  const pickType = useCallback((connector: ConnectorDefinition) => {
    setSelectedConnector(connector);
    setCredentialName(`${connector.label} Credential`);
    setTemplateMode('add-form');
  }, []);

  const cancelForm = useCallback(() => {
    setTemplateMode('pick-type');
    setSelectedConnector(null);
  }, []);

  const resetAll = useCallback(() => {
    setTemplateMode('pick-type');
    setSelectedConnector(null);
    setCredentialName('');
    setTemplateSearch('');
  }, []);

  return {
    templateMode,
    selectedConnector,
    credentialName,
    templateSearch,
    isGoogleTemplate,
    effectiveTemplateFields,
    filteredConnectors,
    setCredentialName,
    setTemplateSearch,
    pickType,
    cancelForm,
    resetAll,
  };
}
