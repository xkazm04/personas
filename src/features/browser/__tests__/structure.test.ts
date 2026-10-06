/**
 * Structural tests: the invariants that are true of the SOURCE rather than of
 * any value a unit test could hold.
 *
 * THE VISIBILITY OWNER. The page host is a separate OS window, so "is it on
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
