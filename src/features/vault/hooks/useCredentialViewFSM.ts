import { useReducer, useCallback, useMemo, useEffect } from 'react';
import type { ConnectorDefinition } from '@/lib/types/types';
import { createFSM } from '@/lib/fsm';
import { createLogger } from '@/lib/log';
import { getAuthMethods } from '@/lib/types/types';
import { isGoogleOAuthConnector } from '@/lib/utils/platform/connectors';
import { useCredentialNav, type CredentialNavKey } from './CredentialNavContext';

const logger = createLogger('credential-view-fsm');

// -- View names (the finite states) ----------------------------------

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
  | 'add-autopilot'
  | 'workspace-connect'
  | 'foraging'
  | 'databases'
  | 'graph';

// -- Discriminated union: each state carries exactly the data it needs --

export type CredentialViewState =
  | { view: 'list' }
  | { view: 'catalog-browse'; search: string }
  | { view: 'catalog-form'; connector: ConnectorDefinition; credentialName: string; parentSearch: string; oauthValues?: Record<string, string> }
  | { view: 'catalog-auto-setup'; connector: ConnectorDefinition; parentSearch: string }
  | { view: 'add-new' }
  | { view: 'add-api-tool' }
  | { view: 'add-mcp' }
  | { view: 'add-custom' }
  | { view: 'add-database' }
  | { view: 'add-desktop' }
  | { view: 'add-wizard' }
  | { view: 'add-autopilot' }
  | { view: 'workspace-connect' }
  | { view: 'foraging' }
  | { view: 'databases' }
  | { view: 'graph' };

// -- Typed actions --

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
  | { type: 'GO_ADD_AUTOPILOT' }
  | { type: 'GO_WORKSPACE_CONNECT' }
  | { type: 'GO_FORAGING' }
  | { type: 'GO_DATABASES' }
  | { type: 'GO_GRAPH' }
  | { type: 'SET_OAUTH_VALUES'; values: Record<string, string> };

// -- Transition Table ------------------------------------------------
//
// Uses the universal FSM framework from @/lib/fsm. The action-level
// transition table is built on top of the view-level FSM. Each view
// declares which action types it accepts; global navigation actions
// are valid from every view.
//
// The `credentialViewFSM` validates view->view transitions, while
// the action table gates which actions are allowed per view.

type ActionType = CredentialViewAction['type'];

// Sidebar navigation actions are valid from any view
const GLOBAL_ACTIONS: ActionType[] = ['GO_LIST', 'GO_CATALOG', 'GO_ADD_NEW', 'GO_ADD_WIZARD', 'GO_ADD_AUTOPILOT', 'GO_WORKSPACE_CONNECT', 'GO_DATABASES', 'GO_GRAPH'];

/** View-specific transitions (in addition to global actions). */
const VIEW_TRANSITIONS: Record<ViewName, readonly ActionType[]> = {
  'list':               [],
  'catalog-browse':     ['PICK_CONNECTOR', 'SET_CATALOG_SEARCH'],
  'catalog-form':       ['CANCEL_FORM', 'GO_AUTO_SETUP', 'GO_ADD_DESKTOP', 'SET_CREDENTIAL_NAME', 'SET_OAUTH_VALUES'],
  'catalog-auto-setup': ['CANCEL_FORM'],
  'add-new':            ['GO_ADD_API_TOOL', 'GO_ADD_MCP', 'GO_ADD_CUSTOM', 'GO_ADD_DATABASE', 'GO_ADD_DESKTOP', 'GO_ADD_WIZARD', 'GO_ADD_AUTOPILOT', 'GO_WORKSPACE_CONNECT', 'GO_FORAGING'],
  'add-api-tool':       [],
  'add-mcp':            [],
  'add-custom':         [],
  'add-database':       [],
  'add-desktop':        [],
  'add-wizard':         [],
  'add-autopilot':      [],
  'workspace-connect':  [],
  'foraging':           [],
  'databases':          [],
  'graph':              [],
};

/** View-level FSM: validates that a view->view navigation is structurally valid. */
export const credentialViewFSM = createFSM<ViewName>({
  entity: 'credential-view',
  transitions: {
    'list':               ['catalog-browse', 'add-new', 'add-wizard', 'workspace-connect', 'databases', 'graph'],
    'catalog-browse':     ['list', 'catalog-form', 'add-new', 'add-wizard', 'workspace-connect', 'databases', 'graph'],
    'catalog-form':       ['list', 'catalog-browse', 'catalog-auto-setup', 'add-new', 'add-desktop', 'add-wizard', 'workspace-connect', 'databases', 'graph'],
    'catalog-auto-setup': ['list', 'catalog-browse', 'add-new', 'add-wizard', 'workspace-connect', 'databases', 'graph'],
    'add-new':            ['list', 'catalog-browse', 'add-api-tool', 'add-mcp', 'add-custom', 'add-database', 'add-desktop', 'add-wizard', 'add-autopilot', 'workspace-connect', 'foraging', 'databases', 'graph'],
    'add-api-tool':       ['list', 'catalog-browse', 'add-new', 'add-wizard', 'workspace-connect', 'databases', 'graph'],
    'add-mcp':            ['list', 'catalog-browse', 'add-new', 'add-wizard', 'workspace-connect', 'databases', 'graph'],
    'add-custom':         ['list', 'catalog-browse', 'add-new', 'add-wizard', 'workspace-connect', 'databases', 'graph'],
    'add-database':       ['list', 'catalog-browse', 'add-new', 'add-wizard', 'workspace-connect', 'databases', 'graph'],
    'add-desktop':        ['list', 'catalog-browse', 'add-new', 'add-wizard', 'workspace-connect', 'databases', 'graph'],
    'add-wizard':         ['list', 'catalog-browse', 'add-new', 'workspace-connect', 'databases', 'graph'],
    'add-autopilot':      ['list', 'catalog-browse', 'add-new', 'add-wizard', 'workspace-connect', 'databases', 'graph'],
    'workspace-connect':  ['list', 'catalog-browse', 'add-new', 'add-wizard', 'databases', 'graph'],
    'foraging':           ['list', 'catalog-browse', 'add-new', 'add-wizard', 'workspace-connect', 'databases', 'graph'],
    'databases':          ['list', 'catalog-browse', 'add-new', 'add-wizard', 'workspace-connect', 'graph'],
    'graph':              ['list', 'catalog-browse', 'add-new', 'add-wizard', 'workspace-connect', 'databases'],
  },
});

function buildActionTable(): Record<ViewName, ReadonlySet<ActionType>> {
  const table = {} as Record<ViewName, ReadonlySet<ActionType>>;
  for (const view of Object.keys(VIEW_TRANSITIONS) as ViewName[]) {
    table[view] = new Set([...GLOBAL_ACTIONS, ...VIEW_TRANSITIONS[view]]);
  }
  return table;
}

const ACTION_TABLE = buildActionTable();

/** Check whether an action is valid for the current view. */
function isValidTransition(view: ViewName, action: ActionType): boolean {
  return ACTION_TABLE[view].has(action);
}

// -- Nav key for sidebar highlighting --

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
  'add-autopilot':      'autopilot',
  'workspace-connect':  'add-new',
  'foraging':           'add-new',
  'databases':          'databases',
  'graph':              'graph',
};

export function getNavKey(state: CredentialViewState): CredentialNavKey {
  return NAV_KEY_MAP[state.view];
}

// -- Action handlers -------------------------------------------------
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
const GO_ADD_AUTOPILOT: ActionHandler = () => ({ view: 'add-autopilot' });
const GO_WORKSPACE_CONNECT: ActionHandler = () => ({ view: 'workspace-connect' });
const GO_FORAGING: ActionHandler = () => ({ view: 'foraging' });
const GO_DATABASES: ActionHandler = () => ({ view: 'databases' });
const GO_GRAPH: ActionHandler = () => ({ view: 'graph' });

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

const SET_OAUTH_VALUES: ActionHandler<Extract<CredentialViewAction, { type: 'SET_OAUTH_VALUES' }>> =
  (state, action) => {
    if (state.view === 'catalog-form') {
      return { ...state, oauthValues: action.values };
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
  GO_ADD_AUTOPILOT: GO_ADD_AUTOPILOT as ActionHandler<never>,
  GO_WORKSPACE_CONNECT: GO_WORKSPACE_CONNECT as ActionHandler<never>,
  GO_FORAGING: GO_FORAGING as ActionHandler<never>,
  GO_DATABASES: GO_DATABASES as ActionHandler<never>,
  GO_GRAPH: GO_GRAPH as ActionHandler<never>,
  SET_OAUTH_VALUES: SET_OAUTH_VALUES as ActionHandler<never>,
};

// -- Reducer ---------------------------------------------------------

function reducer(state: CredentialViewState, action: CredentialViewAction): CredentialViewState {
  if (!isValidTransition(state.view, action.type)) {
    logger.warn('Invalid transition', { view: state.view, action: action.type });
    return state;
  }
  const handler = ACTION_HANDLERS[action.type];
  return handler(state, action as never);
}

const INITIAL_STATE: CredentialViewState = { view: 'list' };

// -- Breadcrumb derivation -------------------------------------------

export interface BreadcrumbSegment {
  label: string;
  action: CredentialViewAction | null; // null = current (non-clickable)
}

/** Derive an ordered breadcrumb trail from the current FSM state. */
export function getBreadcrumbs(state: CredentialViewState): BreadcrumbSegment[] {
  const root: BreadcrumbSegment = { label: 'Credentials', action: { type: 'GO_LIST' } };

  switch (state.view) {
    case 'list':
      return [{ ...root, action: null }];

    case 'catalog-browse':
      return [root, { label: 'From Template', action: null }];
    case 'catalog-form':
      return [
        root,
        { label: 'From Template', action: { type: 'CANCEL_FORM' } },
        { label: state.connector.label, action: null },
      ];
    case 'catalog-auto-setup':
      return [
        root,
        { label: 'From Template', action: { type: 'CANCEL_FORM' } },
        { label: state.connector.label, action: null },
      ];

    case 'add-new':
      return [root, { label: 'Add New', action: null }];
    case 'add-api-tool':
      return [root, { label: 'Add New', action: { type: 'GO_ADD_NEW' } }, { label: 'API Tool', action: null }];
    case 'add-mcp':
      return [root, { label: 'Add New', action: { type: 'GO_ADD_NEW' } }, { label: 'MCP Server', action: null }];
    case 'add-custom':
      return [root, { label: 'Add New', action: { type: 'GO_ADD_NEW' } }, { label: 'Custom', action: null }];
    case 'add-database':
      return [root, { label: 'Add New', action: { type: 'GO_ADD_NEW' } }, { label: 'Database', action: null }];
    case 'add-desktop':
      return [root, { label: 'Add New', action: { type: 'GO_ADD_NEW' } }, { label: 'Desktop App', action: null }];
    case 'add-wizard':
      return [root, { label: 'Add New', action: { type: 'GO_ADD_NEW' } }, { label: 'Setup Wizard', action: null }];
    case 'add-autopilot':
      return [root, { label: 'Add New', action: { type: 'GO_ADD_NEW' } }, { label: 'API Autopilot', action: null }];
    case 'workspace-connect':
      return [root, { label: 'Workspace Connect', action: null }];
    case 'foraging':
      return [root, { label: 'Add New', action: { type: 'GO_ADD_NEW' } }, { label: 'Foraging', action: null }];

    case 'databases':
      return [{ label: 'Databases', action: null }];
    case 'graph':
      return [{ label: 'Graph', action: null }];

    default:
      return [{ ...root, action: null }];
  }
}

// -- Hook ------------------------------------------------------------

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
      case 'graph':
        dispatch({ type: 'GO_GRAPH' });
        break;
      case 'autopilot':
        dispatch({ type: 'GO_ADD_AUTOPILOT' });
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

  const breadcrumbs = useMemo(() => getBreadcrumbs(state), [state]);

  return {
    state,
    dispatch,
    navKey,
    navigateFromSidebar,
    filteredConnectors,
    catalogFormData,
    breadcrumbs,
  };
}
