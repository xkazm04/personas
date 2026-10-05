/**
 * Structural tests: the invariants that are true of the SOURCE rather than of
 * any value a unit test could hold.
 *
 * 1. SERVER VARIANT PARITY. The four Server control prototypes are a switcher
 *    over one contract (`servers/serverVariantProps.ts`); a variant that
 *    widened its own props would silently stop being swappable. TypeScript
 *    enforces assignability where `ServerSection` builds its
 *    `Record<ServerVariantId, ServerVariant>` map (test files are outside
 *    `tsc`, so that annotation IS the type check); this pins the map, the id
 *    list and each module's default export to one another.
 *
 * 2. THE VISIBILITY OWNER. The page host is a separate OS window, so "is it on
 *    screen" is derived from the ROUTE STATE by one owner mounted at the app
 *    root (`webview/hostVisibility.ts`), never written by the page's own
 *    effects: two effects writing `true` on mount with one `false` on unmount,
 *    over async IPC with no ordering guarantee, left a page floating over an
 *    unrelated route (2026-09-18). A defect no render test would catch, because
 *    the offending window is not in the React tree at all.
 */
import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { SERVER_VARIANT_IDS } from '../servers/serverVariantProps';

const HERE = dirname(fileURLToPath(import.meta.url));
const read = (rel: string) => readFileSync(resolve(HERE, '..', rel), 'utf8');

/** `id: Component` pairs inside ServerSection's VARIANTS map. */
function variantMap(source: string): Record<string, string> {
  const match = /const VARIANTS: Record<ServerVariantId, ServerVariant> = \{([\s\S]*?)\};/.exec(source);
  if (!match) return {};
  return Object.fromEntries([...match[1]!.matchAll(/(\w+): (\w+),/g)].map((m) => [m[1]!, m[2]!]));
}

describe('Server control variant parity', () => {
  const section = read('servers/ServerSection.tsx');
  const map = variantMap(section);

  it('maps every variant id, and only those, through the typed contract', () => {
    expect(section).toMatch(/const VARIANTS: Record<ServerVariantId, ServerVariant> = \{/);
    expect(Object.keys(map).sort()).toEqual([...SERVER_VARIANT_IDS].sort());
  });

  it.each([...SERVER_VARIANT_IDS])('%s is a module whose default export takes ServerVariantProps', async (id) => {
    const component = map[id]!;
    expect(section).toContain(`import ${component} from './variants/${component}';`);
    const rel = `servers/variants/${component}.tsx`;
    expect(existsSync(resolve(HERE, '..', rel))).toBe(true);
    // Either a default function typed by the shared props, or a const typed as the variant.
    expect(read(rel)).toMatch(
      /export default function \w+\([\s\S]*?:\s*ServerVariantProps\)|:\s*ServerVariant\b[\s\S]*export default/,
    );
    const mod = (await import(`../servers/variants/${component}.tsx`)) as { default: unknown };
    expect(typeof mod.default).toBe('function');
    // A variant module pulls in the i18n proxy and its chart helpers: a cold import is slow on a busy machine.
  }, 60_000);
});

describe('Webview host visibility', () => {
  const page = read('webview/WebviewPage.tsx');
  const owner = read('webview/hostVisibility.ts');
  const app = readFileSync(resolve(HERE, '..', '..', '..', 'App.tsx'), 'utf8');

  it('the page never writes the host visibility itself', () => {
    expect(page).not.toMatch(/setVisible\(/);
  });

  it('one owner derives it from the route and hides it on teardown', () => {
    expect(owner).toMatch(/sidebarSection === HOST_SECTION && s\.teamsTab === HOST_TAB/);
    expect(owner).toMatch(/setVisible\(show\)/);
    expect(owner).toMatch(/setVisible\(false\)/);
  });

  it('the owner is mounted at the app root', () => {
    expect(app).toMatch(/<BrowserHostVisibility \/>/);
  });

  it('a failed tab list is not painted as the no-tabs empty state', () => {
    expect(page).toMatch(/tabsError/);
    expect(page).toMatch(/t\.common\.retry/);
  });

  it('routes a navigation refusal through messageOf', () => {
    expect(page).toMatch(/messageOf\(/);
    expect(page).not.toMatch(/String\(err\)/);
  });

  it('opens no modal of its own, because a modal would render behind the page', () => {
    // The JSX element, not the word — the file's own header explains WHY it
    // must not render one, and a naive substring match would fail on the
    // explanation instead of on the defect.
    expect(page).not.toMatch(/<BaseModal[\s/>]/);
  });
});
