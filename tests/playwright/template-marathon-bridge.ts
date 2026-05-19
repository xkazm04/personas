/**
 * Adoption-flow primitives layered on the existing companion-bridge's
 * HTTP-to-app machinery. Same pattern: `/bridge-exec` for results,
 * `/click-testid` for interactions, `/query` + `/find-text` for assertions.
 *
 * Marathon phases (open / picker / questionnaire / build / promote /
 * execute / verify) each get a high-level helper. Spec is just an
 * orchestration of these.
 */

const BASE_URL = `http://127.0.0.1:${Number(process.env.COMPANION_TEST_PORT ?? 17320)}`;

interface QueryNode {
  tag: string;
  text: string;
  id: string | null;
  testId: string | null;
  visible: boolean;
  /** Server includes className when emitting /query results; surface it
   *  for tests that need to discriminate visual state (disabled vs
   *  enabled, active tab, etc.). */
  className?: string;
}

async function post<T = unknown>(path: string, body: unknown = {}): Promise<T> {
  const res = await fetch(`${BASE_URL}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`POST ${path} → ${res.status}: ${text}`);
  }
  return (await res.json()) as T;
}

async function get<T = unknown>(path: string): Promise<T> {
  const res = await fetch(`${BASE_URL}${path}`);
  if (!res.ok) throw new Error(`GET ${path} → ${res.status}`);
  return (await res.json()) as T;
}

async function bridgeExec<T = unknown>(
  method: string,
  params: Record<string, unknown> = {},
  timeoutSecs = 60,
): Promise<T> {
  const raw = await post<string>('/bridge-exec', { method, params, timeout_secs: timeoutSecs });
  const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw;
  if (parsed && typeof parsed === 'object' && 'error' in parsed && (parsed as { error: unknown }).error) {
    throw new Error(`bridge ${method}: ${(parsed as { error: string }).error}`);
  }
  return parsed as T;
}

export const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

/** Confirm the test-automation server is reachable. Throws on failure. */
export async function health(): Promise<void> {
  const h = await get<{ status: string }>('/health');
  if (h.status !== 'ok') throw new Error(`health: status=${h.status}`);
}

/** Click an element by data-testid. */
export const clickTestId = (testId: string): Promise<unknown> =>
  post('/click-testid', { test_id: testId });

/** Find by visible text — exact match. Returns the first hit's nodes. */
export const findText = (text: string): Promise<QueryNode[]> =>
  post('/find-text', { text });

export const query = (selector: string): Promise<QueryNode[]> =>
  post('/query', { selector });

/** Navigate via the sidebar router. `section` should be one of the
 *  values accepted by `SystemStore.setSidebarSection`. */
export const navigate = (section: string): Promise<unknown> =>
  post('/navigate', { section });

/** Wait until `selector` matches at least one visible element. Resolves
 *  on success, rejects on timeout. Polls at 200 ms. */
export async function waitForVisible(selector: string, timeoutMs = 10_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const nodes = await query(selector);
    if (nodes.some((n) => n.visible)) return;
    await sleep(200);
  }
  throw new Error(`waitForVisible: ${selector} not visible in ${timeoutMs}ms`);
}

/** Wait until a button labeled `text` is visible + enabled, then click. */
export async function clickByText(text: string, timeoutMs = 10_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const nodes = await findText(text);
    // Bridge's /find-text returns DOM tag lowercased ("button", "a"), but
    // older code compared against uppercase — every clickByText silently
    // hit its 15s timeout because no node ever matched.
    const button = nodes.find((n) => {
      const tag = (n.tag ?? '').toLowerCase();
      return n.visible && (tag === 'button' || tag === 'a');
    });
    if (button) {
      // Click via /eval since /find-text doesn't surface a stable selector
      // for arbitrary elements. innerText match is asymmetric in case
      // (CSS-uppercase labels return innerText uppercase even when the
      // i18n string is "Continue"); rendered case is what we matched on.
      await post('/eval', {
        js: `Array.from(document.querySelectorAll('button,a')).find(b => (b.innerText||'').trim() === ${JSON.stringify(text)})?.click();`,
      });
      return;
    }
    await sleep(200);
  }
  throw new Error(`clickByText: "${text}" not found in ${timeoutMs}ms`);
}

/** Persona executions row shape (read via invokeCommand("list_persona_executions")
 *  which the bridge exposes). Loose typing — we only need a few fields. */
export interface ExecutionRow {
  id: string;
  persona_id: string;
  status: string;
  cost_usd?: number;
  duration_ms?: number;
  tool_steps?: string | null;
  created_at: string;
}

/** Read the most recent N executions for a persona via the bridge.
 *  `list_executions` is the real command name; it accepts a personaId
 *  filter as `persona_id` (snake_case on the wire). */
export async function listPersonaExecutions(personaId: string, limit = 5): Promise<ExecutionRow[]> {
  const out = await bridgeExec<{ executions?: ExecutionRow[] } | ExecutionRow[]>(
    'invokeCommand',
    { command: 'list_executions', params: { persona_id: personaId, limit } },
    30,
  );
  // The command may return either `{ executions: [...] }` or a bare array
  // depending on which list endpoint the bridge resolved — defensively
  // unwrap both shapes.
  if (Array.isArray(out)) return out;
  return (out as { executions?: ExecutionRow[] })?.executions ?? [];
}

/** Wait for a new completed (or failed) execution row for `personaId`,
 *  scanning rows with `created_at > sinceIso`. */
export async function waitForExecution(
  personaId: string,
  sinceIso: string,
  timeoutMs = 180_000,
): Promise<ExecutionRow | null> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const rows = await listPersonaExecutions(personaId, 10);
    const matched = rows.find((r) => r.created_at > sinceIso && (r.status === 'completed' || r.status === 'failed'));
    if (matched) return matched;
    await sleep(3_000);
  }
  return null;
}

/** Read the current adoption modal's state — used by the post-promote
 *  step to capture the newly-created persona id. The bridge's
 *  `invokeCommand` wraps the underlying result as
 *  `{success, result, error}`, so we read `r.result` for the real
 *  session payload (the earlier code read `r.personaId` which always
 *  resolved to undefined → persona_id null → execute phase couldn't
 *  fire). When the build session has already torn down after promote,
 *  fall back to reading the agentStore via `getState` which still
 *  carries the most-recent buildPersonaId. */
export async function readAdoptionState(): Promise<{
  open: boolean;
  activeVariant: 'classic' | 'persona-layout' | null;
  activeCap: string | null;
  unansweredCount: number;
  blockedCount: number;
  buildPhase: string | null;
  personaId: string | null;
}> {
  type SessionPayload = { id?: string; personaId?: string; phase?: string } | null;
  const r = await bridgeExec<{ success: boolean; result?: SessionPayload }>(
    'invokeCommand',
    { command: 'get_active_build_session', params: { personaId: '' } },
    10,
  );
  let session: SessionPayload = r?.result ?? null;
  // Fallback when the session was torn down on promote — the agent
  // store still mirrors the last buildPersonaId.
  if (!session) {
    const snap = await bridgeExec<Record<string, unknown>>('getState', {}, 10);
    const buildPersonaId = (snap?.buildPersonaId as string | null | undefined) ?? null;
    const buildPhase = (snap?.buildPhase as string | null | undefined) ?? null;
    if (buildPersonaId) session = { personaId: buildPersonaId, phase: buildPhase ?? undefined };
  }
  return {
    open: !!session,
    activeVariant: null,
    activeCap: null,
    unansweredCount: 0,
    blockedCount: 0,
    buildPhase: session?.phase ?? null,
    personaId: session?.personaId ?? null,
  };
}

/** Seed the open adoption modal's questionnaire with `answers` in a
 *  single bridge call. The modal listens for `test:seed-adoption` and
 *  merges answers + marks questionsComplete=true, unlocking the
 *  Continue-to-Build CTA without per-question UI driving.
 *
 *  Falls back to a generic placeholder for empty-default questions so
 *  every required key has a non-empty string (canContinue checks
 *  `!!userAnswers[q.id]`, so the empty string was the blocker for
 *  Demo Recorder's `aq_output_dir` and similar). */
export async function seedAdoptionAnswers(answers: Record<string, string>): Promise<void> {
  const result = await bridgeExec<{ success: boolean; count?: number; error?: string }>(
    'seedAdoptionAnswers',
    { answers },
    10,
  );
  if (!result.success) throw new Error(`seedAdoptionAnswers: ${result.error ?? 'unknown'}`);
}

/** Switch the adoption modal's variant tab. The switcher uses
 *  role="tab" buttons without explicit data-testids, so we click by
 *  visible text label (matches the i18n key
 *  `templates.adopt_modal.layout_tab_persona_layout`). */
export async function selectAdoptionVariant(variant: 'classic' | 'persona-layout'): Promise<void> {
  const label = variant === 'persona-layout' ? 'Persona Layout' : 'Classic';
  // Find the tab in the AdoptionLayoutSwitcher region. innerText match
  // is asymmetric with CSS uppercasing, but these labels don't use
  // text-transform — safe to match raw.
  await post('/eval', {
    js: `(()=>{const btn = Array.from(document.querySelectorAll('[role="tab"]')).find(b => (b.innerText||'').trim().startsWith(${JSON.stringify(label)})); if(btn) btn.click(); })();`,
  });
  await sleep(200);
}

/** Wait for the build phase to transition into one of the target phases.
 *  The underlying bridge method caps its internal wait at 20s
 *  (src/test/automation/bridge.ts:1618), so we re-invoke in a loop until
 *  the overall timeoutMs is reached. Logs intermediate phase progression
 *  for diagnostics. */
export async function waitForBuildPhase(
  phases: string[],
  timeoutMs = 5 * 60_000,
): Promise<string> {
  const deadline = Date.now() + timeoutMs;
  let lastPhase: string | undefined;
  while (Date.now() < deadline) {
    const remaining = deadline - Date.now();
    const slice = Math.min(remaining, 18_000);
    const result = await bridgeExec<{
      success: boolean;
      phase?: string;
      error?: string;
      timedOut?: boolean;
      pendingCount?: number;
    }>('waitForBuildPhase', { phases, timeoutMs: slice }, Math.ceil(slice / 1000) + 5);
    if (result.success && result.phase) return result.phase;
    if (result.error) throw new Error(`waitForBuildPhase: ${result.error}`);
    // Hard-error on phases that mean the build will never reach `phases`.
    if (result.phase === 'failed' || result.phase === 'cancelled') {
      throw new Error(`build-ended:${result.phase}`);
    }
    if (result.phase && result.phase !== lastPhase) {
      // eslint-disable-next-line no-console
      console.log(`  [build] phase=${result.phase} pending=${result.pendingCount ?? 0}`);
      lastPhase = result.phase;
    }
    // Brief breather between probes so we don't spam bridge-exec.
    await sleep(500);
  }
  throw new Error(`waitForBuildPhase:timeout (last phase=${lastPhase ?? 'unknown'})`);
}

/** Cancel any in-flight build session for the given persona — used by
 *  the recovery path when a template's adoption gets stuck. */
export async function cancelBuildSession(sessionId: string): Promise<void> {
  await bridgeExec('invokeCommand', {
    command: 'cancel_build_session',
    params: { sessionId },
  }, 30);
}
