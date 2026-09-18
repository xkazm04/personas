/**
 * Structural tests — the two invariants that are true of the SOURCE rather
 * than of any value a unit test could hold.
 *
 * 1. VARIANT PROP PARITY. The three Whitelist layouts are a switcher over one
 *    contract; a variant that widened its own props would silently stop being
 *    swappable. TypeScript already enforces assignability where the page
 *    builds its `VARIANTS` map, but nothing stops a variant from destructuring
 *    a subset and quietly ignoring an action. This compares the destructured
 *    names against the declared contract.
 *
 * 2. THE VISIBILITY OWNER. The page host is a separate OS window, so "is it on
 *    screen" is derived from the ROUTE STATE by one owner mounted at the app
 *    root (`webview/hostVisibility.ts`), never written by the page's own
 *    effects: two effects writing `true` on mount with one `false` on unmount,
 *    over async IPC with no ordering guarantee, left a page floating over an
 *    unrelated route (2026-09-18). A defect no render test would catch, because
 *    the offending window is not in the React tree at all.
 */
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

const HERE = dirname(fileURLToPath(import.meta.url));
const read = (rel: string) => readFileSync(resolve(HERE, '..', rel), 'utf8');

/** Names inside the first `{ … }` of the component's parameter list. */
function destructuredProps(source: string): string[] {
  const match = /export default function \w+\(\{([\s\S]*?)\}\s*:/.exec(source);
  if (!match) return [];
  return match[1]
    .split(',')
    .map((part) => part.split(/[=:]/)[0].trim())
    .filter(Boolean);
}

/** Field names declared in `interface WhitelistVariantProps { … }`. */
function contractProps(source: string): string[] {
  const match = /interface WhitelistVariantProps \{([\s\S]*?)\n\}/.exec(source);
  if (!match) return [];
  return [...match[1].matchAll(/^\s{2}(\w+)[?]?:/gm)].map((m) => m[1]);
}

describe('Whitelist variant prop parity', () => {
  const contract = contractProps(read('whitelist/variants/variantProps.ts')).sort();

  it('declares the contract the page documents', () => {
    expect(contract).toEqual(
      ['loading', 'onConfirm', 'onEdit', 'onOpen', 'onRemove', 'onScan', 'onToggle', 'sites'].sort(),
    );
  });

  it.each(['LedgerVariant', 'CardsVariant', 'MasterDetailVariant'])(
    '%s consumes every prop in the contract',
    (name) => {
      const props = destructuredProps(read(`whitelist/variants/${name}.tsx`)).sort();
      expect(props).toEqual(contract);
    },
  );
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

  it('opens no modal of its own, because a modal would render behind the page', () => {
    // The JSX element, not the word — the file's own header explains WHY it
    // must not render one, and a naive substring match would fail on the
    // explanation instead of on the defect.
    expect(page).not.toMatch(/<BaseModal[\s/>]/);
  });
});
