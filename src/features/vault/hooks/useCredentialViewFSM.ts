import { useReducer, useCallback, useMemo, useEffect } from 'react';
import type { ConnectorDefinition } from '@/lib/types/types';
import { getAuthMethods } from '@/lib/types/types';
import { isGoogleOAuthConnector } from '@/lib/utils/connectors';
import { useCredentialNav, type CredentialNavKey } from './CredentialNavContext';

// ── View names (the finite states) ──────────────────────────────────

export type ViewName =
  | 'list'
  | 'catalog-browse'
  | 'catalog-form'
  | 'catalog-auto-setup'
  | 'add-new'
  | 'add-api-tool'
  | 'add-mcp'
  | 'add-custom'
  | 'add-database'
  | 'add-desktop'
  | 'add-wizard'
  | 'workspace-connect'
  | 'foraging'
  | 'databases';

// ── Discriminated union: each state carries exactly the data it needs ──

export type CredentialViewState =
  | { view: 'list' }
  | { view: 'catalog-browse'; search: string }
  | { view: 'catalog-form'; connector: ConnectorDefinition; credentialName: string; parentSearch: string }
  | { view: 'catalog-auto-setup'; connector: ConnectorDefinition; parentSearch: string }
  | { view: 'add-new' }
  | { view: 'add-api-tool' }
  | { view: 'add-mcp' }
  | { view: 'add-custom' }
  | { view: 'add-database' }
  | { view: 'add-desktop' }
  | { view: 'add-wizard' }
  | { view: 'workspace-connect' }
  | { view: 'foraging' }
  | { view: 'databases' };

// ── Typed actions ──

export type CredentialViewAction =
  | { type: 'GO_LIST' }
  | { type: 'GO_CATALOG' }
  | { type: 'PICK_CONNECTOR'; connector: ConnectorDefinition; parentSearch: string }
  | { type: 'GO_AUTO_SETUP'; connector: ConnectorDefinition }
  | { type: 'SET_CREDENTIAL_NAME'; name: string }
  | { type: 'SET_CATALOG_SEARCH'; search: string }
  | { type: 'CANCEL_FORM' }
  | { type: 'GO_ADD_NEW' }
  | { type: 'GO_ADD_API_TOOL' }
  | { type: 'GO_ADD_MCP' }
  | { type: 'GO_ADD_CUSTOM' }
  | { type: 'GO_ADD_DATABASE' }
  | { type: 'GO_ADD_DESKTOP' }
  | { type: 'GO_ADD_WIZARD' }
  | { type: 'GO_WORKSPACE_CONNECT' }
  | { type: 'GO_FORAGING' }
  | { type: 'GO_DATABASES' };

// ── Transition Table ────────────────────────────────────────────────
//
// Explicit map of (sourceView, actionType) → allowed.
// If a transition isn't listed, it's invalid and the reducer ignores it.
// This makes the navigation graph inspectable and prevents impossible states.

type ActionType = CredentialViewAction['type'];

/**
 * For each view, the set of action types that are valid transitions.
 * Actions not listed for a given view are silently ignored (no-op).
 */
// Sidebar navigation actions are valid from any view
const GLOBAL_ACTIONS: ActionType[] = ['GO_LIST', 'GO_CATALOG', 'GO_ADD_NEW', 'GO_ADD_WIZARD', 'GO_WORKSPACE_CONNECT', 'GO_DATABASES'];

/** View-specific transitions (in addition to global actions). */
const VIEW_TRANSITIONS: Record<ViewName, readonly ActionType[]> = {
  'list':               [],
  'catalog-browse':     ['PICK_CONNECTOR', 'SET_CATALOG_SEARCH'],
  'catalog-form':       ['CANCEL_FORM', 'GO_AUTO_SETUP', 'GO_ADD_DESKTOP', 'SET_CREDENTIAL_NAME'],
  'catalog-auto-setup': ['CANCEL_FORM'],
  'add-new':            ['GO_ADD_API_TOOL', 'GO_ADD_MCP', 'GO_ADD_CUSTOM', 'GO_ADD_DATABASE', 'GO_ADD_DESKTOP', 'GO_ADD_WIZARD', 'GO_WORKSPACE_CONNECT', 'GO_FORAGING'],
  'add-api-tool':       [],
  'add-mcp':            [],
  'add-custom':         [],
  'add-database':       [],
  'add-desktop':        [],
  'add-wizard':         [],
  'workspace-connect':  [],
  'foraging':           [],
  'databases':          [],
};

function buildTransitionTable(): Record<ViewName, ReadonlySet<ActionType>> {
  const table = {} as Record<ViewName, ReadonlySet<ActionType>>;
  for (const view of Object.keys(VIEW_TRANSITIONS) as ViewName[]) {
    table[view] = new Set([...GLOBAL_ACTIONS, ...VIEW_TRANSITIONS[view]]);
  }
  return table;
}

const TRANSITION_TABLE = buildTransitionTable();

/** Check whether a transition is valid for the current view. */
function isValidTransition(view: ViewName, action: ActionType): boolean {
  return TRANSITION_TABLE[view].has(action);
}

// ── Nav key for sidebar highlighting ──

const NAV_KEY_MAP: Record<ViewName, CredentialNavKey> = {
  'list':               'credentials',
  'catalog-browse':     'from-template',
  'catalog-form':       'from-template',
  'catalog-auto-setup': 'from-template',
  'add-new':            'add-new',
  'add-api-tool':       'add-new',
  'add-mcp':            'add-new',
  'add-custom':         'add-new',
  'add-database':       'add-new',
  'add-desktop':        'add-new',
  'add-wizard':         'add-new',
  'workspace-connect':  'add-new',
  'foraging':           'add-new',
  'databases':          'databases',
};

export function getNavKey(state: CredentialViewState): CredentialNavKey {
  return NAV_KEY_MAP[state.view];
}

// ── Action handlers ─────────────────────────────────────────────────
//
// Each handler produces the next state for its action type.
// These are only called after the transition table validates the action.

type ActionHandler<A extends CredentialViewAction = CredentialViewAction> =
  (state: CredentialViewState, action: A) => CredentialViewState;

const GO_LIST: ActionHandler = () => ({ view: 'list' });
const GO_CATALOG: ActionHandler = () => ({ view: 'catalog-browse', search: '' });
const GO_ADD_NEW: ActionHandler = () => ({ view: 'add-new' });
const GO_ADD_API_TOOL: ActionHandler = () => ({ view: 'add-api-tool' });
const GO_ADD_MCP: ActionHandler = () => ({ view: 'add-mcp' });
const GO_ADD_CUSTOM: ActionHandler = () => ({ view: 'add-custom' });
const GO_ADD_DATABASE: ActionHandler = () => ({ view: 'add-database' });
const GO_ADD_DESKTOP: ActionHandler = () => ({ view: 'add-desktop' });
const GO_ADD_WIZARD: ActionHandler = () => ({ view: 'add-wizard' });
const GO_WORKSPACE_CONNECT: ActionHandler = () => ({ view: 'workspace-connect' });
const GO_FORAGING: ActionHandler = () => ({ view: 'foraging' });
const GO_DATABASES: ActionHandler = () => ({ view: 'databases' });

const PICK_CONNECTOR: ActionHandler<Extract<CredentialViewAction, { type: 'PICK_CONNECTOR' }>> =
  (_state, action) => {
    const methods = getAuthMethods(action.connector);
    const defaultMethod = methods.find((m) => m.is_default) ?? methods[0];
    const name = `${action.connector.label} ${defaultMethod?.label ?? 'Credential'}`;
    return {
      view: 'catalog-form',
      connector: action.connector,
      credentialName: name,
      parentSearch: action.parentSearch,
    };
  };

const GO_AUTO_SETUP: ActionHandler<Extract<CredentialViewAction, { type: 'GO_AUTO_SETUP' }>> =
  (state, action) => ({
    view: 'catalog-auto-setup',
    connector: action.connector,
    parentSearch: state.view === 'catalog-form' ? state.parentSearch : '',
  });

const SET_CREDENTIAL_NAME: ActionHandler<Extract<CredentialViewAction, { type: 'SET_CREDENTIAL_NAME' }>> =
  (state, action) => {
    if (state.view === 'catalog-form' && state.credentialName !== action.name) {
      return { ...state, credentialName: action.name };
    }
    return state;
  };

const SET_CATALOG_SEARCH: ActionHandler<Extract<CredentialViewAction, { type: 'SET_CATALOG_SEARCH' }>> =
  (state, action) => {
    if (state.view === 'catalog-browse' && state.search !== action.search) {
      return { ...state, search: action.search };
    }
    return state;
  };

const CANCEL_FORM: ActionHandler = (state) => {
  if (state.view === 'catalog-form' || state.view === 'catalog-auto-setup') {
    return { view: 'catalog-browse', search: state.parentSearch || '' };
  }
  return { view: 'list' };
};

/** Map action type to handler. */
const ACTION_HANDLERS: Record<ActionType, ActionHandler<never>> = {
  GO_LIST: GO_LIST as ActionHandler<never>,
  GO_CATALOG: GO_CATALOG as ActionHandler<never>,
  PICK_CONNECTOR: PICK_CONNECTOR as ActionHandler<never>,
  GO_AUTO_SETUP: GO_AUTO_SETUP as ActionHandler<never>,
  SET_CREDENTIAL_NAME: SET_CREDENTIAL_NAME as ActionHandler<never>,
  SET_CATALOG_SEARCH: SET_CATALOG_SEARCH as ActionHandler<never>,
  CANCEL_FORM: CANCEL_FORM as ActionHandler<never>,
  GO_ADD_NEW: GO_ADD_NEW as ActionHandler<never>,
  GO_ADD_API_TOOL: GO_ADD_API_TOOL as ActionHandler<never>,
  GO_ADD_MCP: GO_ADD_MCP as ActionHandler<never>,
  GO_ADD_CUSTOM: GO_ADD_CUSTOM as ActionHandler<never>,
  GO_ADD_DATABASE: GO_ADD_DATABASE as ActionHandler<never>,
  GO_ADD_DESKTOP: GO_ADD_DESKTOP as ActionHandler<never>,
  GO_ADD_WIZARD: GO_ADD_WIZARD as ActionHandler<never>,
  GO_WORKSPACE_CONNECT: GO_WORKSPACE_CONNECT as ActionHandler<never>,
  GO_FORAGING: GO_FORAGING as ActionHandler<never>,
  GO_DATABASES: GO_DATABASES as ActionHandler<never>,
};

// ── Reducer ─────────────────────────────────────────────────────────

function reducer(state: CredentialViewState, action: CredentialViewAction): CredentialViewState {
  if (!isValidTransition(state.view, action.type)) {
    if (process.env.NODE_ENV === 'development') {
      console.warn(`[CredentialFSM] Invalid transition: ${state.view} + ${action.type}`);
    }
    return state;
  }
  const handler = ACTION_HANDLERS[action.type];
  return handler(state, action as never);
}

const INITIAL_STATE: CredentialViewState = { view: 'list' };

// ── Hook ────────────────────────────────────────────────────────────

export function useCredentialViewFSM(connectorDefinitions: ConnectorDefinition[]) {
  const [state, dispatch] = useReducer(reducer, INITIAL_STATE);
  const nav = useCredentialNav();

  const navKey = getNavKey(state);

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
      case 'databases':
        dispatch({ type: 'GO_DATABASES' });
        break;
    }
  }, []);

  useEffect(() => {
    nav.setNavigateHandler(navigateFromSidebar);
    return () => { nav.setNavigateHandler(null); };
  }, [navigateFromSidebar, nav]);

  useEffect(() => {
    nav.setCurrentKey(navKey);
  }, [nav, navKey]);

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
