import { useReducer, useCallback, useMemo } from 'react';
import type { ConnectorDefinition } from '@/lib/types/types';
import { getAuthMethods } from '@/lib/types/types';
import { isGoogleOAuthConnector } from '@/lib/utils/connectors';

// ── Discriminated union: each state carries exactly the data it needs ──

export type CredentialViewState =
  | { view: 'list' }
  | { view: 'catalog-browse'; search: string }
  | { view: 'catalog-form'; connector: ConnectorDefinition; credentialName: string }
  | { view: 'add-new' }
  | { view: 'add-api-tool' }
  | { view: 'add-mcp' }
  | { view: 'add-custom' }
  | { view: 'add-database' };

// ── Typed actions ──

export type CredentialViewAction =
  | { type: 'GO_LIST' }
  | { type: 'GO_CATALOG' }
  | { type: 'PICK_CONNECTOR'; connector: ConnectorDefinition }
  | { type: 'SET_CREDENTIAL_NAME'; name: string }
  | { type: 'SET_CATALOG_SEARCH'; search: string }
  | { type: 'CANCEL_FORM' }
  | { type: 'GO_ADD_NEW' }
  | { type: 'GO_ADD_API_TOOL' }
  | { type: 'GO_ADD_MCP' }
  | { type: 'GO_ADD_CUSTOM' }
  | { type: 'GO_ADD_DATABASE' };

// ── Nav key for sidebar highlighting ──

export type CredentialNavKey = 'credentials' | 'from-template' | 'add-new';

export function getNavKey(state: CredentialViewState): CredentialNavKey {
  switch (state.view) {
    case 'list':
      return 'credentials';
    case 'catalog-browse':
    case 'catalog-form':
      return 'from-template';
    case 'add-new':
    case 'add-api-tool':
    case 'add-mcp':
    case 'add-custom':
    case 'add-database':
      return 'add-new';
  }
}

// ── Reducer ──

function reducer(state: CredentialViewState, action: CredentialViewAction): CredentialViewState {
  switch (action.type) {
    case 'GO_LIST':
      return { view: 'list' };

    case 'GO_CATALOG':
      return { view: 'catalog-browse', search: '' };

    case 'PICK_CONNECTOR': {
      const methods = getAuthMethods(action.connector);
      const defaultMethod = methods.find((m) => m.is_default) ?? methods[0];
      const name = `${action.connector.label} ${defaultMethod?.label ?? 'Credential'}`;
      return { view: 'catalog-form', connector: action.connector, credentialName: name };
    }

    case 'SET_CREDENTIAL_NAME':
      if (state.view === 'catalog-form') {
        return { ...state, credentialName: action.name };
      }
      return state;

    case 'SET_CATALOG_SEARCH':
      if (state.view === 'catalog-browse') {
        return { ...state, search: action.search };
      }
      return state;

    case 'CANCEL_FORM':
      if (state.view === 'catalog-form') {
        return { view: 'catalog-browse', search: '' };
      }
      return { view: 'list' };

    case 'GO_ADD_NEW':
      return { view: 'add-new' };

    case 'GO_ADD_API_TOOL':
      return { view: 'add-api-tool' };

    case 'GO_ADD_MCP':
      return { view: 'add-mcp' };

    case 'GO_ADD_CUSTOM':
      return { view: 'add-custom' };

    case 'GO_ADD_DATABASE':
      return { view: 'add-database' };
  }
}

const INITIAL_STATE: CredentialViewState = { view: 'list' };

// ── Hook ──

export function useCredentialViewFSM(connectorDefinitions: ConnectorDefinition[]) {
  const [state, dispatch] = useReducer(reducer, INITIAL_STATE);

  const navKey = getNavKey(state);

  // Navigate from sidebar nav key
  const navigateFromSidebar = useCallback((key: CredentialNavKey) => {
    switch (key) {
      case 'credentials':
        dispatch({ type: 'GO_LIST' });
        break;
      case 'from-template':
        dispatch({ type: 'GO_CATALOG' });
        break;
      case 'add-new':
        dispatch({ type: 'GO_ADD_NEW' });
        break;
    }
  }, []);

  // Derived: filtered connectors (only available in catalog-browse)
  const filteredConnectors = useMemo(() => {
    if (state.view !== 'catalog-browse') return connectorDefinitions;
    const q = state.search.trim().toLowerCase();
    if (!q) return connectorDefinitions;
    return connectorDefinitions.filter(
      (c) =>
        c.label.toLowerCase().includes(q) ||
        c.name.toLowerCase().includes(q) ||
        c.category.toLowerCase().includes(q),
    );
  }, [state, connectorDefinitions]);

  // Derived: template form helpers (only meaningful in catalog-form)
  const catalogFormData = useMemo(() => {
    if (state.view !== 'catalog-form') return null;
    const { connector, credentialName } = state;
    const isGoogle = isGoogleOAuthConnector(connector);
    const fields = connector.fields
      ? isGoogle
        ? connector.fields.filter(
            (f) => !['client_id', 'client_secret', 'refresh_token', 'scopes'].includes(f.key),
          )
        : connector.fields
      : [];
    return { connector, credentialName, isGoogle, fields };
  }, [state]);

  return {
    state,
    dispatch,
    navKey,
    navigateFromSidebar,
    filteredConnectors,
    catalogFormData,
  };
}
