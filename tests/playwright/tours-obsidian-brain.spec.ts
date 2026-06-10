/**
 * Live walkthrough of the `obsidian-brain` guided tour against a real app
 * instance — the mixed-completion counterpart to tours-explore.spec.ts.
 *
 * Unlike the pure-exploration tours, this tour has two non-acknowledge steps
 * that this spec exercises for real:
 *
 * - `obsidian-install` — GuidedTour probes `obsidian_available` on entry and
 *   the step completes by itself when the Obsidian binary is installed on
 *   this machine. When it isn't, the acknowledge button is the documented
 *   fallback — the spec handles both, so it's machine-agnostic.
 * - `obsidian-vault-connect` — driven end-to-end: the spec creates a
 *   throwaway vault folder on disk (with a `.obsidian/` dir), fills the
 *   manual path input, presses Test, then Save Configuration. The step must
 *   complete via the REAL `tour:obsidian-vault-connected` event emitted by
 *   SetupPanel — no tourEmit shortcuts.
 *
 * Every step additionally asserts its Brain tab panel anchor mounted
 * (`obsidian-<tab>-panel`), which proves the `setObsidianBrainTab` nav
 * setter in GuidedTour navigates the real UI.
 *
 * Run against a fresh isolated instance (own data dir + shifted ports):
 *   TOURS_FRESH_SPEC=tours-obsidian-brain.spec.ts npm run test:tours:fresh
 * or against an already-running tauri:dev:test on :17320:
 *   npx playwright test tours-obsidian-brain.spec.ts
 */
import { test, expect } from '@playwright/test';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { CompanionBridge, bridge } from './companion-bridge';

const TOUR_ID = 'obsidian-brain';

/** Step id → the Brain tab panel anchor its nav must mount. */
const STEP_ANCHORS: Record<string, string> = {
  'obsidian-install': 'obsidian-setup-panel',
  'obsidian-vault-connect': 'obsidian-setup-panel',
  'obsidian-sync-tab': 'obsidian-sync-panel',
  'obsidian-browse-tab': 'obsidian-browse-panel',
  'obsidian-graph-tab': 'obsidian-graph-panel',
  'obsidian-cloud-tab': 'obsidian-cloud-panel',
  'obsidian-revitalize-tab': 'obsidian-revitalize-panel',
  'obsidian-memory-dimensions': 'obsidian-setup-panel',
};

let app: CompanionBridge;
let vaultDir: string;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function waitPresent(selector: string, timeoutMs = 30_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if ((await app.query(selector)).length > 0) return;
    await sleep(300);
  }
  throw new Error(`selector not present within ${timeoutMs}ms: ${selector}`);
}

async function isStepDone(stepId: string): Promise<boolean> {
  const s = await app.tourState();
  return s.stepCompleted.find((x) => x.id === stepId)?.done ?? false;
}

async function expectStepDone(stepId: string, timeoutMs = 15_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await isStepDone(stepId)) return;
    await sleep(400);
  }
  const s = await app.tourState();
  throw new Error(
    `step "${stepId}" not completed within ${timeoutMs}ms; progress=${JSON.stringify(s.stepCompleted)}`,
  );
}

test.describe('Obsidian Brain tour — live walkthrough (detection + real vault connect)', () => {
  test.setTimeout(240_000);

  test.beforeAll(async () => {
    app = bridge();
    const h = await app.health();
    expect(h.status).toBe('ok');
    await app.bootstrapFreshUser();

    // A real vault on disk for the connect step: a folder with a .obsidian
    // dir and one note — exactly what obsidian_brain_test_connection checks.
    vaultDir = mkdtempSync(join(tmpdir(), 'personas-tour-vault-'));
    mkdirSync(join(vaultDir, '.obsidian'));
    writeFileSync(join(vaultDir, 'Welcome.md'), '# Welcome\n\nA note for the tour walk.\n');
  });

  test.afterAll(async () => {
    if (vaultDir) rmSync(vaultDir, { recursive: true, force: true });
  });

  test('walks all 8 steps start to finish', async () => {
    await app.tourReset(TOUR_ID);
    await app.tourStart(TOUR_ID);
    await waitPresent('[data-testid="tour-panel"]');

    const state = await app.tourState();
    expect(state.active).toBe(true);
    expect(state.tourId).toBe(TOUR_ID);
    expect(state.stepIds).toEqual(Object.keys(STEP_ANCHORS));

    for (let i = 0; i < state.stepIds.length; i++) {
      const stepId = state.stepIds[i]!;

      // The step's nav (plugins section + Brain tab via setObsidianBrainTab)
      // runs on activation; the tab's panel anchor must actually mount.
      await sleep(700);
      await waitPresent(`[data-testid="${STEP_ANCHORS[stepId]}"]`, 15_000);

      if (stepId === 'obsidian-install') {
        // Give the obsidian_available probe a moment to auto-complete; fall
        // back to acknowledge when Obsidian isn't installed on this machine.
        const probeDeadline = Date.now() + 6_000;
        while (Date.now() < probeDeadline && !(await isStepDone(stepId))) {
          await sleep(400);
        }
        if (!(await isStepDone(stepId))) {
          await waitPresent('[data-testid="tour-btn-acknowledge"]', 10_000);
          await app.clickTestId('tour-btn-acknowledge');
        }
        await expectStepDone(stepId);
      } else if (stepId === 'obsidian-vault-connect') {
        // Fresh DB → no vault → drive the real Setup flow end-to-end.
        if (!(await isStepDone(stepId))) {
          await app.fillField('obsidian-vault-path-input', vaultDir);
          await app.clickTestId('obsidian-test-connection');
          // Save enables once the test verdict lands; retry until the real
          // tour:obsidian-vault-connected event completes the step.
          const saveDeadline = Date.now() + 20_000;
          while (Date.now() < saveDeadline && !(await isStepDone(stepId))) {
            await app.clickTestId('obsidian-save-config');
            await sleep(600);
          }
        }
        await expectStepDone(stepId);
      } else {
        // Exploration stop — acknowledge.
        await waitPresent('[data-testid="tour-btn-acknowledge"]', 10_000);
        await app.clickTestId('tour-btn-acknowledge');
        await expectStepDone(stepId);
      }

      if (i < state.stepIds.length - 1) {
        await app.clickTestId('tour-btn-next');
      }
    }

    let final = await app.tourState();
    expect(final.allCompleted).toBe(true);
    await app.clickTestId('tour-btn-finish');
    // The completion celebration screen interposes; "Done" finalizes the tour.
    await sleep(400);
    if ((await app.query('[data-testid="tour-completion-done"]')).length > 0) {
      await app.clickTestId('tour-completion-done');
      await sleep(300);
    }
    final = await app.tourState();
    expect(final.completed).toBe(true);

    await app.tourReset(TOUR_ID);
  });
});
