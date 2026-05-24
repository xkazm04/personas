/**
 * Diagnostic + regression spec for the template-adoption Persona Layout
 * surface. Two bugs the user reported on 2026-05-17 after the
 * `cb550566e` fix shipped to master:
 *
 *  1. Main content area can't be scrolled even though the page is
 *     taller than the modal panel.
 *  2. "Add credential" clicks are silent — the QuickAddCredentialModal
 *     never appears.
 *
 * Pre-condition for the spec: the user has the template adoption modal
 * open in the Persona Layout tab on the running tauri:dev:test
 * instance. The spec doesn't drive navigation (no testid surface on
 * the picker / templates browse paths yet) — it inspects the live DOM
 * and answers "is `cb550566e`'s structural change actually present
 * in the running bundle?".
 *
 * If the assertions pass, the running build contains the fix and the
 * user's perception of "no change" is a stale browser cache or a
 * different state. If they fail, the bundle is pre-fix.
 */
import { test, expect } from '@playwright/test';
import { AdoptionBridge } from './adoption-bridge';

const bridge = new AdoptionBridge();

test.describe('Adoption — Persona Layout pre-seed (diagnostic)', () => {
  test.beforeAll(async () => {
    const health = await bridge.health();
    expect(health.status).toBe('ok');
  });

  test('adoption modal is open (precondition)', async () => {
    const root = await bridge.getAdoptionModalRoot();
    if (!root) {
      test.fail(
        true,
        'Adoption modal is not open. Open Templates → Adopt any template → switch to "Persona Layout · Prototype" tab, then re-run.',
      );
      return;
    }
    expect(root.tag).toBe('DIV');
    expect(root.visible).toBe(true);
  });

  test('Persona Layout tab is active (or switch to it)', async () => {
    // If the user has Classic tab active, switch — both bugs only
    // surface in Persona Layout.
    const layoutTabs = await bridge.getLayoutTabs();
    const personaTab = layoutTabs.find((t) => (t.text ?? '').includes('Persona Layout'));
    expect(personaTab).toBeDefined();
    if (personaTab && personaTab.className && !personaTab.className.includes('bg-primary/20')) {
      await bridge.clickPersonaLayoutTab();
    }
  });

  test('BUG 1 — ChronologyAdoptionView wrapper has the post-fix class chain', async () => {
    // The signature change in `cb550566e` swapped the outer wrapper's
    // class from `"flex flex-col h-full min-h-0"` (pre-fix) to
    // `"flex-1 min-h-0 flex flex-col"` (post-fix). The post-fix value
    // is what allows the inner overflow-y-auto to actually engage.
    //
    // If this assertion fails, the running bundle does NOT contain
    // commit cb550566e — the user's HMR/Vite missed it or the dev
    // server is serving stale source. Fix is real but not delivered.
    const className = await bridge.getAdoptionContentRootClassName();
    expect(className, 'ChronologyAdoptionView wrapper className').not.toBeNull();
    expect(
      className,
      `expected POST-fix class chain (cb550566e); got: ${className ?? '<null>'}`,
    ).toContain('flex-1 min-h-0');
    expect(className).not.toContain('flex flex-col h-full min-h-0');
  });

  test('BUG 1 — main scroll container has scrollHeight > clientHeight (proves overflow engaged)', async () => {
    // The scroll container is PersonaLayout's inner wrapper at
    // `flex-1 min-h-0 overflow-y-auto scrollbar-thin`. After cb550566e
    // it should be bounded by the modal panel's 92vh minus the title
    // bar; its content (header band + sigil + below-hero + rows)
    // should exceed that bounded height, so scrollHeight > clientHeight.
    //
    // If clientHeight is large (>= scrollHeight) the container has no
    // height bound — that's the bug: the chain above isn't constraining
    // it. If clientHeight is 0, the element isn't laid out at all.
    const metrics = await bridge.getScrollMetrics(
      '[aria-labelledby="adoption-matrix-title"] .scrollbar-thin',
    );
    expect(metrics, 'scroll container should exist in the adoption modal').not.toBeNull();
    if (!metrics) return;
    expect(metrics.clientHeight, 'clientHeight should be > 0 (container is laid out)').toBeGreaterThan(0);
    expect(
      metrics.scrollHeight,
      `scrollHeight (${metrics.scrollHeight}) should exceed clientHeight (${metrics.clientHeight}) — content must overflow for scroll to be needed`,
    ).toBeGreaterThan(metrics.clientHeight);
  });

  test('BUG 1 — scrollTop can be moved (container actually scrolls)', async () => {
    // Set scrollTop to a large value; the container should clamp to
    // (scrollHeight - clientHeight) and we read that back. If the
    // chain above isn't engaging overflow-y-auto, scrollTop stays 0.
    const selector = '[aria-labelledby="adoption-matrix-title"] .scrollbar-thin';
    await bridge.eval(`
      (() => {
        const el = document.querySelector(${JSON.stringify(selector)});
        if (el) el.scrollTop = 9999;
      })();
    `);
    const after = await bridge.getScrollMetrics(selector);
    expect(after).not.toBeNull();
    if (!after) return;
    expect(
      after.scrollTop,
      'scrollTop should clamp to a positive value when overflow engages',
    ).toBeGreaterThan(0);
  });

  test('BUG 2 — clicking "Add credential" opens the QuickAddCredentialModal', async () => {
    // Only meaningful when a question with `vault_category` is
    // currently surfaced. Locate the center count-button first to open
    // the answer card (or skip if there are no pending questions).
    const centerButton = await bridge.findButton('questions to answer');
    if (!centerButton) {
      test.skip(true, 'no pending questions in current adoption — cannot exercise Add credential');
      return;
    }
    // Open the first unanswered question
    await bridge.clickButtonByText('Click to start');

    // Look for the Add credential button inside the now-open card.
    // The label may be "Add credential" or "Connect a provider" — find
    // either.
    const addBtn =
      (await bridge.findButton('Add credential')) ??
      (await bridge.findButton('Connect a'));
    if (!addBtn) {
      test.skip(
        true,
        'no Add-credential affordance in the open card — current question may not be vault-category',
      );
      return;
    }
    await bridge.clickButtonByText(addBtn.text);

    // Allow the modal to mount + portal-render.
    await new Promise((r) => setTimeout(r, 400));

    // Expect QuickAddCredentialModal to be in DOM and visible.
    const open = await bridge.isQuickAddCredentialModalOpen();
    expect(
      open,
      'QuickAddCredentialModal should be mounted after clicking Add credential — if false, the modal is either not rendered (cb550566e missing) or rendered in an invisible layer (z-index / portal issue)',
    ).toBe(true);
  });
});
