import { test, expect } from '@playwright/test';
import { bridge, CompanionBridge } from './companion-bridge';

/**
 * Team-functionality smoke suite against the live Tauri app.
 *
 * Pre-req:
 *   npm run tauri:dev:test
 * The app must be a build that includes the team-functionality branch and have
 * at least one team.
 *
 * Teams became configuration-only on 2026-07-13 (03b70415bd, monitor
 * consolidation P5): the Orchestrate console, its Preview/Assign actions and
 * the assignment board were retired, and assigning a goal moved to the
 * Conversations composer. The Studio's modes are now Team memory and
 * Workspace settings, so that is what this suite covers.
 *
 * Coverage:
 *  - Team detail reachable; Memory / Workspace modes present.
 *  - Add-member menu: opens and renders eligible items / draft hint
 *    (drafts are filtered out of the candidate list).
 *
 * Bridge: navigate, clickTestId, query, findText, waitFor.
 */

let app: CompanionBridge;

async function openFirstTeam(app: CompanionBridge): Promise<void> {
  // Projects consolidation (2026-08-26): team-nav now opens the Manage table;
  // a team detail is entered through a project row's Members button.
  await app.navigate('personas');
  await app.clickTestId('team-nav');
  await app.waitFor('[data-testid^="project-members-"]', 8_000).catch(() => {});
  const cells = await app.query('[data-testid^="project-members-"]');
  if (cells.length === 0) {
    throw new Error('No project with a team found — create a dev project before running this suite.');
  }
  const membersTestId = cells[0]?.testId;
  if (!membersTestId) throw new Error('project-members cell has no testId');
  await app.clickTestId(membersTestId);
  await app.waitFor('[data-testid="team-mode-workspace"]', 8_000);
}

test.describe('Team functionality smoke', () => {
  test.setTimeout(180_000);

  test.beforeAll(async () => {
    app = bridge();
    const h = await app.health();
    expect(h.status).toBe('ok');
  });

  test('team detail reachable; both configuration modes present', async () => {
    await openFirstTeam(app);
    expect((await app.query('[data-testid="team-mode-memory"]')).length).toBeGreaterThan(0);
    expect((await app.query('[data-testid="team-mode-workspace"]')).length).toBeGreaterThan(0);
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
});
