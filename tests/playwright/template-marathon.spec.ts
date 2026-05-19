/**
 * Template marathon — single-template Playwright spec.
 *
 * Invoked once per template by the Node driver:
 *   TEMPLATE_ID=email-morning-digest npx playwright test template-marathon.spec.ts
 *
 * Writes per-template result to `tests/results/marathon/<template-id>.json`.
 * Driver aggregates by reading those files.
 */
import { test, expect } from '@playwright/test';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  clickByText,
  clickTestId,
  findText,
  health,
  navigate,
  query,
  readAdoptionState,
  selectAdoptionVariant,
  sleep,
  waitForBuildPhase,
  waitForExecution,
  waitForVisible,
} from './template-marathon-bridge';
import { DEFAULT_VAULT, loadAllTemplates, matchVault } from './template-marathon-fixtures';

const TEMPLATE_ID = process.env.TEMPLATE_ID;
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const RESULTS_DIR = join(__dirname, '..', '..', 'tests', 'results', 'marathon');

if (!TEMPLATE_ID) {
  throw new Error('TEMPLATE_ID env var required — invoke via the driver, not directly.');
}

interface PhaseOutcome {
  phase: string;
  status: 'pass' | 'soft-fail' | 'hard-fail' | 'skipped';
  detail?: string;
  durationMs?: number;
}

interface TemplateResult {
  template_id: string;
  template_name: string;
  category: string;
  started_at: string;
  ended_at: string;
  outcome: 'pass' | 'soft-fail' | 'hard-fail';
  phases: PhaseOutcome[];
  persona_id: string | null;
  /** First hard-fail's symptom string — drives the driver's signature
   *  matcher for auto-fix decisions. */
  failure_signature: string | null;
  capability_results: Array<{
    cap_id: string;
    outcome: 'pass' | 'soft-fail' | 'hard-fail' | 'skipped';
    execution_id?: string;
    tool_steps?: number;
    cost_usd?: number;
    detail?: string;
  }>;
}

function writeResult(result: TemplateResult): void {
  if (!existsSync(RESULTS_DIR)) mkdirSync(RESULTS_DIR, { recursive: true });
  writeFileSync(join(RESULTS_DIR, `${TEMPLATE_ID}.json`), JSON.stringify(result, null, 2));
}

async function runPhase<T>(
  phases: PhaseOutcome[],
  name: string,
  fn: () => Promise<T>,
): Promise<{ ok: boolean; value: T | null; error: string | null }> {
  const started = Date.now();
  try {
    const value = await fn();
    phases.push({ phase: name, status: 'pass', durationMs: Date.now() - started });
    return { ok: true, value, error: null };
  } catch (e) {
    const detail = e instanceof Error ? e.message : String(e);
    phases.push({ phase: name, status: 'hard-fail', detail, durationMs: Date.now() - started });
    return { ok: false, value: null, error: detail };
  }
}

test('marathon-template', async () => {
  test.setTimeout(15 * 60_000); // 15-min cap per template

  const allTemplates = loadAllTemplates();
  const eligible = matchVault(allTemplates, DEFAULT_VAULT).filter((t) => t.missingConnectors.length === 0);
  const target = eligible.find((t) => t.id === TEMPLATE_ID);
  if (!target) {
    const fallback = allTemplates.find((t) => t.id === TEMPLATE_ID);
    if (!fallback) throw new Error(`Template not found: ${TEMPLATE_ID}`);
    const result: TemplateResult = {
      template_id: TEMPLATE_ID,
      template_name: fallback.name,
      category: fallback.category,
      started_at: new Date().toISOString(),
      ended_at: new Date().toISOString(),
      outcome: 'hard-fail',
      phases: [],
      persona_id: null,
      failure_signature: 'eligibility:missing-connectors',
      capability_results: [],
    };
    writeResult(result);
    expect.soft(target).toBeTruthy();
    return;
  }

  const result: TemplateResult = {
    template_id: target.id,
    template_name: target.name,
    category: target.category,
    started_at: new Date().toISOString(),
    ended_at: '',
    outcome: 'hard-fail',
    phases: [],
    persona_id: null,
    failure_signature: null,
    capability_results: [],
  };

  // --- Health gate + bridge warm-up ---
  await health();
  // Bridge can take up to 60s to be responsive after a fresh app start
  // (tti_ms ~ 61201 observed). Probe with cheap getState() calls until
  // the bridge stops timing out. This is the difference between "smoke
  // #1 504'd on navigate" and "smoke #N actually drives the UI."
  {
    const deadline = Date.now() + 90_000;
    let ready = false;
    while (Date.now() < deadline) {
      try {
        const r = await fetch(`http://127.0.0.1:${Number(process.env.COMPANION_TEST_PORT ?? 17320)}/bridge-exec`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ method: 'getState', params: {}, timeout_secs: 5 }),
        });
        if (r.ok) { ready = true; break; }
      } catch { /* retry */ }
      await sleep(2_000);
    }
    if (!ready) {
      result.failure_signature = 'phase:open:bridge-warmup-timeout';
      result.ended_at = new Date().toISOString();
      writeResult(result);
      expect(ready, 'Bridge never became responsive within 90s').toBe(true);
      return;
    }
  }

  // --- Phase 1: Open template + Glyph variant ---
  const openResult = await runPhase(result.phases, 'open', async () => {
    await navigate('design-reviews');
    await sleep(800);
    // The default templateTab is 'generated' (uiSlice.ts:164) — exactly
    // the gallery we want. No tab switching needed; the legacy click on
    // 'template-tab-recipes' from earlier smoke runs landed on Recipes
    // (which does not show templates) and ate the Adopt-button search.

    // Wait for the gallery to render at least one template row.
    {
      const deadline = Date.now() + 30_000;
      let any = false;
      while (Date.now() < deadline) {
        const rows = await query('[data-testid^="template-row-"]');
        if (rows.some((n) => n.visible)) { any = true; break; }
        await sleep(500);
      }
      if (!any) throw new Error('gallery-empty');
    }

    // Gallery rendering uses `ComfortableRow` (data-testid="template-row-<id>"),
    // not the standalone TemplateCard. Rows collapse by default; Adopt
    // button is in the ExpandedRowContent (data-testid="template-adopt-button")
    // and only appears after the row is clicked to expand.
    //
    // We avoid /eval entirely here — Tauri's webview.eval queue has been
    // observed to silently drop scripts mid-session. clickTestId goes
    // through a different bridge code path (__test_respond) and is the
    // reliable path. Strategy:
    //   1. Enumerate visible rows via /query
    //   2. Match by innerText substring against target.name
    //   3. clickTestId(rowTestId) to expand
    //   4. clickTestId('template-adopt-button')
    let matchedRowId: string | null = null;
    {
      const deadline = Date.now() + 45_000;
      while (Date.now() < deadline) {
        const rows = await query('[data-testid^="template-row-"]');
        const hit = rows.find(
          (r) => r.visible && r.testId && r.text && r.text.includes(target.name),
        );
        if (hit?.testId) {
          matchedRowId = hit.testId;
          break;
        }
        await sleep(750);
      }
    }
    if (!matchedRowId) throw new Error('template-row-not-found');

    // Expand the row. clickTestId may need a retry if the row hasn't
    // fully mounted into the virtualised list yet.
    await clickTestId(matchedRowId);
    // Wait for the Adopt button (testid added 2026-05-19 in ExpandedRowContent.tsx)
    // to appear in the expanded panel.
    try {
      await waitForVisible('[data-testid="template-adopt-button"]', 10_000);
    } catch {
      // One retry — row click may have collapsed an already-expanded row.
      await clickTestId(matchedRowId);
      await waitForVisible('[data-testid="template-adopt-button"]', 10_000);
    }
    await clickTestId('template-adopt-button');
    await sleep(500);
    // Wait for the adoption modal. BaseModal uses role="dialog";
    // there's no specific testid on the AdoptionWizardModal so we
    // match the dialog + the id of the title node.
    await waitForVisible('[role="dialog"], #adoption-matrix-title', 15_000);
    // Switch to persona-layout (Glyph) variant
    await selectAdoptionVariant('persona-layout');
    await sleep(300);
    return { opened: true };
  });
  if (!openResult.ok) {
    result.failure_signature = `phase:open:${openResult.error ?? 'unknown'}`;
    result.ended_at = new Date().toISOString();
    writeResult(result);
    expect(openResult.ok, `Phase 1 (open): ${openResult.error}`).toBe(true);
    return;
  }

  // --- Phase 2-3: capability picker + questionnaire ---
  // These are tightly coupled: the answer card appears after the picker.
  // Implementation: drive the bridge's `answerPendingBuildQuestions` for
  // each pending question OR find the answer-card and click default.
  await runPhase(result.phases, 'questionnaire', async () => {
    // Loop up to 60 iterations (cap at ~2 min of questionnaire driving)
    for (let i = 0; i < 60; i++) {
      const state = await readAdoptionState();
      if (state.buildPhase && state.buildPhase !== 'initializing') break;
      // Look for the AdoptionAnswerCard's "Send" or "Done" affordance
      const sendNodes = await findText('Send answer');
      const doneNodes = await findText('Done');
      if (doneNodes.some((n) => n.visible)) {
        await clickByText('Done', 5_000);
        await sleep(500);
        break;
      }
      if (sendNodes.some((n) => n.visible)) {
        // Pick first visible option in the answer card; the bridge's
        // /eval helper handles the click. Production iteration would
        // refine which option is "best" — for now first-visible
        // matches the migration spec's vault-detected behaviour.
        await fetch(`http://127.0.0.1:${Number(process.env.COMPANION_TEST_PORT ?? 17320)}/eval`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            js: `(()=>{const opt=document.querySelector('[data-testid*="question-option"]:not([disabled])'); if(opt) opt.click(); })();`,
          }),
        });
        await sleep(300);
        await clickByText('Send answer', 5_000).catch(() => {});
        await sleep(400);
        continue;
      }
      // No question — perhaps all answered. Try Continue.
      const continueNodes = await findText('Continue to Build');
      if (continueNodes.some((n) => n.visible)) break;
      await sleep(700);
    }
    return { answered: true };
  });

  // --- Phase 4: Continue + Build wait ---
  const buildResult = await runPhase(result.phases, 'build', async () => {
    // Wait for the Continue button to be enabled, then click via testid
    // (the modal's primary CTA was hardcoded English before the testid
    // landed; clickByText also worked through /eval which has been
    // observed to silently drop queued scripts mid-session). Routing
    // through __test_respond is the reliable path.
    await waitForVisible('[data-testid="adopt-continue-to-build"]', 15_000);
    await clickTestId('adopt-continue-to-build');
    await sleep(600);
    const phase = await waitForBuildPhase(['draft_ready', 'test_complete', 'failed', 'cancelled'], 6 * 60_000);
    if (phase === 'failed' || phase === 'cancelled') {
      throw new Error(`build-ended:${phase}`);
    }
    return { finalPhase: phase };
  });
  if (!buildResult.ok) {
    result.failure_signature = `phase:build:${buildResult.error ?? 'unknown'}`;
    result.ended_at = new Date().toISOString();
    writeResult(result);
    expect(buildResult.ok, `Phase 4 (build): ${buildResult.error}`).toBe(true);
    return;
  }

  // --- Phase 5: Promote ---
  const promoteResult = await runPhase(result.phases, 'promote', async () => {
    await clickByText('Promote', 8_000).catch(async () => {
      // Try Force Promote when the standard promote button isn't present
      await clickByText('Approve & Promote', 5_000);
    });
    const phase = await waitForBuildPhase(['promoted', 'failed', 'cancelled'], 3 * 60_000);
    if (phase !== 'promoted') throw new Error(`promote-ended:${phase}`);
    // Capture the persona id from the latest build session
    const state = await readAdoptionState();
    if (state.personaId) result.persona_id = state.personaId;
    return { personaId: state.personaId };
  });
  if (!promoteResult.ok) {
    result.failure_signature = `phase:promote:${promoteResult.error ?? 'unknown'}`;
    result.ended_at = new Date().toISOString();
    writeResult(result);
    expect(promoteResult.ok, `Phase 5 (promote): ${promoteResult.error}`).toBe(true);
    return;
  }

  // --- Phase 6: Execute each capability ---
  // Pre-execution timestamp to filter "new" executions.
  const preExecuteIso = new Date().toISOString();
  if (!result.persona_id) {
    result.failure_signature = 'phase:execute:no-persona-id';
    result.outcome = 'hard-fail';
    result.ended_at = new Date().toISOString();
    writeResult(result);
    return;
  }

  // Read capabilities from the template (we already have them on `target`,
  // but the post-promote persona may have different ids). Re-read via
  // bridge's design context for accuracy.
  const designCtx = await fetch(`http://127.0.0.1:${Number(process.env.COMPANION_TEST_PORT ?? 17320)}/bridge-exec`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      method: 'invokeCommand',
      params: { command: 'get_persona', params: { id: result.persona_id } },
      timeout_secs: 15,
    }),
  });
  const personaRaw = (await designCtx.json().catch(() => null)) as string | null;
  let parsedDesignContext: { use_cases?: Array<{ id?: string; suggested_trigger?: { type?: string } }> } = {};
  try {
    if (personaRaw) {
      const persona = JSON.parse(personaRaw) as { design_context?: string };
      if (persona.design_context) parsedDesignContext = JSON.parse(persona.design_context);
    }
  } catch { /* fall through with empty */ }

  const capabilities = parsedDesignContext.use_cases ?? [];
  for (const cap of capabilities) {
    const capId = cap.id ?? '?';
    const triggerType = cap.suggested_trigger?.type ?? 'manual';
    if (triggerType === 'event_listener') {
      result.capability_results.push({ cap_id: capId, outcome: 'skipped', detail: 'event-listener (not manually invokable)' });
      continue;
    }
    try {
      await fetch(`http://127.0.0.1:${Number(process.env.COMPANION_TEST_PORT ?? 17320)}/bridge-exec`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          method: 'invokeCommand',
          params: { command: 'execute_persona', params: { name_or_id: result.persona_id, use_case_id: capId } },
          timeout_secs: 30,
        }),
      });
      const row = await waitForExecution(result.persona_id, preExecuteIso, 4 * 60_000);
      if (!row) {
        result.capability_results.push({ cap_id: capId, outcome: 'hard-fail', detail: 'execution-timeout' });
        continue;
      }
      if (row.status === 'failed') {
        result.capability_results.push({ cap_id: capId, outcome: 'hard-fail', execution_id: row.id, detail: 'execution-failed' });
        continue;
      }
      // Phase 7: minimal metadata check — at least one tool step
      let toolStepCount = 0;
      if (row.tool_steps) {
        try {
          const parsed = JSON.parse(row.tool_steps);
          if (Array.isArray(parsed)) toolStepCount = parsed.length;
        } catch { /* corrupt JSON */ }
      }
      result.capability_results.push({
        cap_id: capId,
        outcome: toolStepCount > 0 ? 'pass' : 'soft-fail',
        execution_id: row.id,
        tool_steps: toolStepCount,
        cost_usd: row.cost_usd,
        detail: toolStepCount === 0 ? 'empty-execution' : undefined,
      });
    } catch (e) {
      const detail = e instanceof Error ? e.message : String(e);
      result.capability_results.push({ cap_id: capId, outcome: 'hard-fail', detail });
    }
  }

  // --- Outcome resolution ---
  const hardFails = result.capability_results.filter((r) => r.outcome === 'hard-fail');
  const softFails = result.capability_results.filter((r) => r.outcome === 'soft-fail');
  if (hardFails.length > 0) {
    result.outcome = 'hard-fail';
    result.failure_signature = `phase:execute:${hardFails[0]!.detail ?? 'unknown'}`;
  } else if (softFails.length > 0) {
    result.outcome = 'soft-fail';
    result.failure_signature = `phase:verify:${softFails[0]!.detail ?? 'unknown'}`;
  } else {
    result.outcome = 'pass';
  }

  result.ended_at = new Date().toISOString();
  writeResult(result);

  expect(result.outcome, `Template ${target.id} outcome: ${result.outcome}`).not.toBe('hard-fail');
});
