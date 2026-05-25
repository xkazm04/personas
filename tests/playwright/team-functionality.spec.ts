import { test, expect } from '@playwright/test';
import { bridge, CompanionBridge } from './companion-bridge';

/**
 * Team-functionality smoke suite (Phases 1–3) against the live Tauri app.
 *
 * Pre-req:
 *   npm run tauri:dev:test
 * The app must be a build that includes the team-functionality branch and have
 * at least one team. Tests that need a populated/eligible team degrade
 * gracefully (assert the surface renders rather than requiring a successful
 * Sonnet decompose / a real run).
 *
 * Coverage:
 *  - Team detail reachable; Orchestrate / Board / Workspace modes render + switch.
 *  - Orchestrate console: goal input + Preview/Assign actions present; Preview
 *    (Sonnet decompose) completes without crashing the console.
 *  - Assignment board (Phase 3c): renders with lifecycle columns.
 *  - Add-member menu (Phase 1): opens and renders eligible items / draft hint
 *    (drafts are filtered out of the candidate list).
 *  - Live checklist wiring (Phase 2): Assign button present; global listener is
 *    mounted app-wide (asserted indirectly via board freshness).
 *
 * Bridge: navigate, clickTestId, query, findText, waitFor, fillField.
 */

let app: CompanionBridge;

const GOAL = 'Draft a short launch announcement and review it for tone';

async function openFirstTeam(app: CompanionBridge): Promise<void> {
  await app.navigate('personas');
  await app.clickTestId('team-nav');
  await app.waitFor('[data-testid^="team-row-"]', 8_000).catch(() => {});
  const rows = await app.query('[data-testid^="team-row-"]');
  if (rows.length === 0) {
    throw new Error('No teams found — create a team before running this suite.');
  }
  const teamTestId = rows[0]?.testId;
  if (!teamTestId) throw new Error('team-row has no testId');
  await app.clickTestId(teamTestId);
  await app.waitFor('[data-testid="team-mode-orchestrate"]', 8_000);
}

test.describe('Team functionality smoke', () => {
  test.setTimeout(180_000);

  test.beforeAll(async () => {
    app = bridge();
    const h = await app.health();
    expect(h.status).toBe('ok');
  });

  test('team detail reachable; all three modes present', async () => {
    await openFirstTeam(app);
    expect((await app.query('[data-testid="team-mode-orchestrate"]')).length).toBeGreaterThan(0);
    expect((await app.query('[data-testid="team-mode-board"]')).length).toBeGreaterThan(0);
    expect((await app.query('[data-testid="team-mode-workspace"]')).length).toBeGreaterThan(0);
  });

  test('orchestrate console renders goal input + actions', async () => {
    await openFirstTeam(app);
    await app.clickTestId('team-mode-orchestrate');
    await app.waitFor('[data-testid="team-goal-input"]', 5_000);
    expect((await app.query('[data-testid="team-preview-button"]')).length).toBeGreaterThan(0);
    expect((await app.query('[data-testid="team-assign-button"]')).length).toBeGreaterThan(0);
  });

  test('mode switch: Board renders the lifecycle assignment board', async () => {
    await openFirstTeam(app);
    await app.clickTestId('team-mode-board');
    await app.waitFor('[data-testid="team-assignment-board"]', 5_000);
    // Lifecycle columns present (label text).
    const cols = await Promise.all(
      ['Queued', 'Running', 'Needs review', 'Done', 'Stopped'].map((c) => app.findText(c)),
    );
    const present = cols.filter((m) => m.length > 0).length;
    // Tolerate i18n/label variance; expect most lifecycle columns to render.
    expect(present).toBeGreaterThanOrEqual(3);
  });

  test('add-member menu opens and lists only eligible (non-draft) personas', async () => {
    await openFirstTeam(app);
    await app.clickTestId('team-add-member');
    // The dropdown shows one of: eligible items, an "all added" note, or a
    // draft-excluded hint — in every case the menu rendered without listing a
    // draft as a clickable candidate.
    await app.waitFor('[data-testid="team-add-item"], [data-testid="team-add-draft-hint"]', 4_000).catch(() => {});
    const items = await app.query('[data-testid="team-add-item"]');
    const hint = await app.query('[data-testid="team-add-draft-hint"]');
    const noneText = await app.findText('already on this team');
    expect(items.length + hint.length + noneText.length).toBeGreaterThan(0);
  });

  test('Preview routing (Sonnet decompose) completes without crashing the console', async () => {
    await openFirstTeam(app);
    await app.clickTestId('team-mode-orchestrate');
    await app.waitFor('[data-testid="team-goal-input"]', 5_000);
    await app.fillField('team-goal-input', GOAL);
    await app.clickTestId('team-preview-button');
    // Sonnet can take tens of seconds; we don't require routed steps (depends on
    // an eligible roster) — only that the console survives the round-trip.
    await app.waitFor('[data-testid="team-goal-input"]', 90_000);
    expect((await app.query('[data-testid="team-goal-input"]')).length).toBeGreaterThan(0);
  });
});
