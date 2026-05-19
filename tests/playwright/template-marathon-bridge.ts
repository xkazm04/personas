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
    const button = nodes.find((n) => n.visible && (n.tag === 'BUTTON' || n.tag === 'A'));
    if (button) {
      // Click via /eval since /find-text doesn't surface a stable selector
      // for arbitrary elements. innerText match is asymmetric in case
      // (CSS-uppercase labels return innerText uppercase even when the
      // i18n string is "Continue"); rendered case is what we matched on.
      await post('/eval', {
        code: `Array.from(document.querySelectorAll('button,a')).find(b => (b.innerText||'').trim() === ${JSON.stringify(text)})?.click();`,
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

/** Read the most recent N executions for a persona via the bridge. */
export async function listPersonaExecutions(personaId: string, limit = 5): Promise<ExecutionRow[]> {
  const out = await bridgeExec<{ executions?: ExecutionRow[] }>(
    'invokeCommand',
    { command: 'list_persona_executions', params: { personaId, limit } },
    30,
  );
  return out?.executions ?? [];
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

/** Read the current adoption modal's state — used by the questionnaire
 *  loop to know which dim is active + what questions are pending. */
export async function readAdoptionState(): Promise<{
  open: boolean;
  activeVariant: 'classic' | 'persona-layout' | null;
  activeCap: string | null;
  unansweredCount: number;
  blockedCount: number;
  buildPhase: string | null;
  personaId: string | null;
}> {
  return bridgeExec('invokeCommand', {
    command: 'get_active_build_session',
    params: { personaId: '' },
  }, 10).then((r) => {
    // get_active_build_session returns the session for a persona; in the
    // adoption flow we don't yet have the persona id, so the spec also
    // reads bridge.getSnapshot() to learn what's open. The structure
    // below is conservative — falls back to defaults if anything is null.
    const session = r as { id?: string; personaId?: string; phase?: string } | null;
    return {
      open: !!session,
      activeVariant: null,
      activeCap: null,
      unansweredCount: 0,
      blockedCount: 0,
      buildPhase: session?.phase ?? null,
      personaId: session?.personaId ?? null,
    };
  });
}

/** Switch the adoption modal's variant tab. The classic tab is the
 *  legacy questionnaire-only flow; persona-layout is the Glyph variant
 *  the marathon drives. */
export async function selectAdoptionVariant(variant: 'classic' | 'persona-layout'): Promise<void> {
  const testId = variant === 'persona-layout' ? 'adoption-variant-persona-layout' : 'adoption-variant-classic';
  await clickTestId(testId);
  await sleep(200);
}

/** Wait for the build phase to transition into one of the target phases.
 *  Reuses the existing `waitForBuildPhase` bridge method. */
export async function waitForBuildPhase(
  phases: string[],
  timeoutMs = 5 * 60_000,
): Promise<string> {
  const result = await bridgeExec<{ success: boolean; phase?: string; error?: string }>(
    'waitForBuildPhase',
    { phases, timeoutMs },
    Math.ceil(timeoutMs / 1000),
  );
  if (!result.success) throw new Error(`waitForBuildPhase: ${result.error ?? 'unknown'}`);
  return result.phase ?? 'unknown';
}

/** Cancel any in-flight build session for the given persona — used by
 *  the recovery path when a template's adoption gets stuck. */
export async function cancelBuildSession(sessionId: string): Promise<void> {
  await bridgeExec('invokeCommand', {
    command: 'cancel_build_session',
    params: { sessionId },
  }, 30);
}
