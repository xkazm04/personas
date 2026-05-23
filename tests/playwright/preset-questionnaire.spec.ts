/**
 * End-to-end test for the preset combined-questionnaire override path.
 *
 * Drives the LIVE app (start via `npm run tauri:dev:test`) through:
 *
 *   1. Navigate Templates → Presets.
 *   2. Open the `reflective-journaling` preset — a single-member preset
 *      whose member (`vault-grounded-journal-coach`) is the ONE catalog
 *      template that maps adoption questions to `persona.parameters[KEY]`
 *      (as opposed to the 105 templates that map to
 *      `use_cases[].sample_input.*`, which the instant-adopt path does
 *      NOT consume — see the "Override scope" note in
 *      docs/features/templates/08-team-presets.md).
 *   3. Click "Customize", expand the member section, and override two
 *      parameters:
 *        - `aq_coach_tone`        select  gentle → direct
 *        - `aq_pattern_lookback_weeks` number  4 → 12
 *   4. Adopt.
 *   5. Read back the adopted persona's `parameters` column and assert the
 *      overrides landed as `value` (NOT `default_value`, which keeps the
 *      template default).
 *
 * This proves the questionnaire → override IPC → instant_adopt →
 * `populate_persona_parameters_from_design` chain end-to-end for the
 * supported (persona.parameters) mapping. The use_cases-sample_input
 * mapping is a documented follow-up (instant-adopt doesn't apply those).
 *
 * Cleanup: NONE — mirrors the never-delete policy of the sibling specs.
 */

import { test, expect } from '@playwright/test';
import {
  clickTestId,
  invokeCommandRaw,
  health,
  query,
  sleep,
  waitForVisible,
} from './template-marathon-bridge';

const PRESET_ID = 'reflective-journaling';
const EXPECTED_TEAM_NAME = 'Reflective Journaling';
const ROLE = 'coach';
const ADOPTION_TIMEOUT_MS = 120_000;

// The overrides we drive through the UI, plus the persona.parameters key
// each question maps to and the value we expect persisted.
const OVERRIDE_TONE = 'direct'; // default is "gentle"
const OVERRIDE_LOOKBACK = 12; // default is 4

const BASE_URL = `http://127.0.0.1:${Number(process.env.COMPANION_TEST_PORT ?? 17320)}`;

interface ListTeamsResult {
  id: string;
  name: string;
}
interface ListMembersResult {
  id: string;
  team_id: string;
  persona_id: string;
  role: string;
}
interface PersonaParameter {
  key: string;
  value: unknown;
  default_value: unknown;
  type: string;
}

interface QueryNodeLike {
  className?: string;
}

/** Run arbitrary JS in the app window via the bridge's /eval. */
async function evalJs(js: string): Promise<void> {
  const res = await fetch(`${BASE_URL}/eval`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ js }),
  });
  if (!res.ok) throw new Error(`/eval → ${res.status}`);
}

/**
 * Set a React-controlled <select> or <input> value the way React's
 * synthetic event system requires: call the prototype's native value
 * setter (bypassing React's value-tracking shadow), then dispatch a
 * bubbling 'change'/'input' event so the onChange handler fires.
 */
async function setReactInputValue(
  selector: string,
  value: string,
  kind: 'select' | 'input',
): Promise<void> {
  const proto = kind === 'select' ? 'HTMLSelectElement' : 'HTMLInputElement';
  const evt = kind === 'select' ? 'change' : 'input';
  await evalJs(`(() => {
    const el = document.querySelector(${JSON.stringify(selector)});
    if (!el) throw new Error('element not found: ' + ${JSON.stringify(selector)});
    const setter = Object.getOwnPropertyDescriptor(window.${proto}.prototype, 'value').set;
    setter.call(el, ${JSON.stringify(value)});
    el.dispatchEvent(new Event('${evt}', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
  })();`);
}

async function navigateToPresetsTab(): Promise<void> {
  await clickTestId('sidebar-design-reviews');
  await waitForVisible('[data-testid="templates-page"]', 8_000);
  await clickTestId('tab-presets');
  await waitForVisible('[data-testid="preset-library-page"]', 8_000);
}

/**
 * Infer a member row's status from the badge className tokens — the
 * same approach the sibling adoption spec uses (the bridge has no
 * `queryAttribute` method, so we read `[data-testid="preset-row-X"]
 * span` and discriminate on the status-specific text-* tokens the
 * StatusBadge component emits).
 */
async function readRowStatus(role: string): Promise<string> {
  const nodes = (await query(
    `[data-testid="preset-row-${role}"] span`,
  )) as QueryNodeLike[];
  const joined = nodes.map((n) => n.className ?? '').join(' ');
  if (/text-emerald-300/.test(joined)) return 'done';
  if (/text-red-400/.test(joined)) return 'failed';
  if (/animate-spin/.test(joined)) return 'adopting';
  return 'queued';
}

async function waitForRowSettled(role: string, timeoutMs: number): Promise<string> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const status = await readRowStatus(role);
    if (status === 'done' || status === 'failed') return status;
    await sleep(500);
  }
  throw new Error(`row ${role} did not settle within ${timeoutMs}ms`);
}

test('preset questionnaire: parameter overrides land as persona.parameters value', async () => {
  test.setTimeout(ADOPTION_TIMEOUT_MS + 60_000);

  await health();
  await navigateToPresetsTab();

  await waitForVisible(`[data-testid="preset-card-${PRESET_ID}"]`, 10_000);
  await clickTestId(`preset-card-${PRESET_ID}`);
  await waitForVisible(`[data-testid="preset-preview-modal-${PRESET_ID}"]`, 8_000);

  // Open the questionnaire. The Customize toggle only renders when the
  // schema reports questions — this preset's member has 5 parameter
  // questions, so it must appear.
  await waitForVisible('[data-testid="preset-customize-toggle"]', 8_000);
  await clickTestId('preset-customize-toggle');
  await waitForVisible('[data-testid="preset-questionnaire-form"]', 5_000);

  // Expand the member section so the question fields mount.
  await waitForVisible(`[data-testid="preset-questionnaire-member-${ROLE}"]`, 5_000);
  await clickTestId(`preset-questionnaire-member-${ROLE}`);
  await waitForVisible('[data-testid="preset-question-aq_coach_tone"]', 5_000);

  // Override the two parameters via the rendered controls.
  await setReactInputValue(
    '[data-testid="preset-question-aq_coach_tone"] select',
    OVERRIDE_TONE,
    'select',
  );
  await setReactInputValue(
    '[data-testid="preset-question-aq_pattern_lookback_weeks"] input',
    String(OVERRIDE_LOOKBACK),
    'input',
  );
  // Small settle so React commits both onChange updates before adopt.
  await sleep(300);

  // Adopt.
  await clickTestId('preset-adopt-all-button');
  const status = await waitForRowSettled(ROLE, ADOPTION_TIMEOUT_MS);
  expect(status).toBe('done');

  // Resolve team → member → persona.
  const teamsResp = await invokeCommandRaw('list_teams');
  expect(teamsResp.success).toBe(true);
  const team = ((teamsResp.result as ListTeamsResult[]) ?? []).find(
    (t) => t.name === EXPECTED_TEAM_NAME,
  );
  expect(team, `Team "${EXPECTED_TEAM_NAME}" should exist`).toBeTruthy();

  const membersResp = await invokeCommandRaw('list_team_members', {
    teamId: team!.id,
  });
  expect(membersResp.success).toBe(true);
  const members = (membersResp.result as ListMembersResult[]) ?? [];
  const coach = members.find((m) => m.role === ROLE);
  expect(coach, `member role "${ROLE}" should exist`).toBeTruthy();
  expect(coach!.persona_id).toBeTruthy();

  // Read back the persona's parameters and assert the overrides landed.
  const personaResp = await invokeCommandRaw('get_persona', { id: coach!.persona_id });
  expect(personaResp.success).toBe(true);
  const persona = personaResp.result as { parameters?: string | null };
  expect(persona.parameters, 'persona should carry a parameters array').toBeTruthy();

  const params = JSON.parse(persona.parameters as string) as PersonaParameter[];
  const tone = params.find((p) => p.key === 'coach_tone');
  const lookback = params.find((p) => p.key === 'pattern_lookback_weeks');

  expect(tone, 'coach_tone parameter should exist').toBeTruthy();
  expect(tone!.value).toBe(OVERRIDE_TONE);
  // default_value preserves the template original — that's the contract
  // that keeps a future "reset to defaults" well-defined.
  expect(tone!.default_value).toBe('gentle');

  expect(lookback, 'pattern_lookback_weeks parameter should exist').toBeTruthy();
  // Number coercion: the UI sends 12 (number) → stringified on the wire →
  // re-parsed to a JSON number by coerce_answer_to_param_value.
  expect(Number(lookback!.value)).toBe(OVERRIDE_LOOKBACK);
  expect(Number(lookback!.default_value)).toBe(4);
});
