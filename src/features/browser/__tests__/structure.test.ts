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
 * 2. THE VISIBILITY PAIR. The page host is a separate OS window: mounting the
 *    route must show it and unmounting must hide it. A missing
 *    `setVisible(false)` leaves a web page floating over an unrelated route —
 *    a defect no render test would catch, because the offending window is not
 *    in the React tree at all.
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

  it('shows the page host on mount', () => {
    expect(page).toMatch(/setVisible\(true\)/);
  });

  it('hides the page host on unmount — a page must not outlive its route', () => {
    expect(page).toMatch(/setVisible\(false\)/);
  });

  it('opens no modal of its own, because a modal would render behind the page', () => {
    // The JSX element, not the word — the file's own header explains WHY it
    // must not render one, and a naive substring match would fail on the
    // explanation instead of on the defect.
    expect(page).not.toMatch(/<BaseModal[\s/>]/);
  });
});
