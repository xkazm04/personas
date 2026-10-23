import { describe, it, expect } from 'vitest';
import enCatalog from '@/i18n/locales/en.json';
import type { Translations } from '@/i18n/en';
import type { ConnectorDefinition } from '@/lib/types/types';
import { getBreadcrumbs, type CredentialViewState, type ViewName } from '../useCredentialViewFSM';

/**
 * Breadcrumb labels are catalog copy. They were English literals, so the trail
 * read "From Template" / "Graph" in every locale while the sidebar next to it
 * named the same destinations "Catalog" / "Dependencies" in the user's.
 */

/** A catalog whose every leaf is its own key path, so a label that did not
 *  come from the catalog cannot pass for one. */
function keyPathCatalog<T>(node: T, path = ''): T {
  if (typeof node === 'string') return `«${path}»` as T;
  if (node === null || typeof node !== 'object') return node;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(node)) out[k] = keyPathCatalog(v, path ? `${path}.${k}` : k);
  return out as T;
}

const en: Translations = enCatalog;
const connector = { label: 'Stripe' } as ConnectorDefinition;

const STATES: Record<ViewName, CredentialViewState> = {
  'list': { view: 'list' },
  'catalog-browse': { view: 'catalog-browse', search: '' },
  'catalog-form': { view: 'catalog-form', connector, credentialName: 'x', parentSearch: '' },
  'catalog-auto-setup': { view: 'catalog-auto-setup', connector, parentSearch: '' },
  'add-new': { view: 'add-new' },
  'add-ai-guide': { view: 'add-ai-guide' },
  'add-mcp': { view: 'add-mcp' },
  'add-custom': { view: 'add-custom' },
  'add-database': { view: 'add-database' },
  'add-desktop': { view: 'add-desktop' },
  'workspace-connect': { view: 'workspace-connect' },
  'foraging': { view: 'foraging' },
  'databases': { view: 'databases' },
  'graph': { view: 'graph' },
  'broker': { view: 'broker' },
};

describe('getBreadcrumbs', () => {
  it.each(Object.keys(STATES) as ViewName[])('every %s label comes from the catalog', (view) => {
    const t = keyPathCatalog(en);
    for (const seg of getBreadcrumbs(STATES[view], t)) {
      if (seg.label === connector.label) continue; // user data, not copy
      expect(seg.label).toMatch(/^«.+»$/);
    }
  });

  it('names a destination the way the sidebar does', () => {
    expect(getBreadcrumbs(STATES['catalog-browse'], en).map((s) => s.label))
      .toEqual([en.sidebar.credentials, en.sidebar.catalog]);
    expect(getBreadcrumbs(STATES.graph, en).map((s) => s.label)).toEqual([en.sidebar.graph]);
  });
});
