import { test, expect } from '@playwright/test';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { bridge, CompanionBridge } from './companion-bridge';

/**
 * Module smoke — "is any UI module or backend command broken?"
 *
 * This is the suite you run after a deletion/refactor wave to prove the blast
 * radius really was zero. It walks every top-level section and every L2 tab the
 * test bridge can reach, and it invokes one read-only backend command per major
 * module. It is deliberately shallow: it answers "did this surface catastrophic-
 * ally fail", not "does feature X behave correctly".
 *
 * ARCHITECTURE: like every spec in this directory, this does NOT launch a
 * browser. It drives a *real running Tauri app* over HTTP on port 17320.
 *   Pre-req:  npm run tauri:dev:test
 *   Run:      npm run test:smoke
 *
 * ── What this suite can see that the old sidebar-navigation.spec.ts could not ──
 *
 * 1. THE CRASH CARD. `ErrorBoundary`'s `ErrorFallback` now carries
 *    `data-testid="error-boundary-fallback"`. Without it, a section that
 *    crashed on render still "navigated successfully" and still had DOM
 *    content, so every assertion passed while the user saw a crash card.
 *    That matters more here than in most apps: per
 *    docs/concepts/golden-paths/error-boundary.md, the content area is served
 *    by ONE boundary instance and IT DOES NOT FORGET — crash one section and
 *    every section visited afterwards shows the same card, retitled with the
 *    healthy section's name. So the walk FAILS FAST and names the FIRST
 *    section that crashed; everything after it is a consequence, not a cause.
 *
 * 2. THE SECTIONS THAT DRIFTED OUT. The old spec hard-coded 9 of the 11
 *    `SidebarSection` values — `teams` and `studio` were simply missing. This
 *    spec parses the union out of `src/lib/types/types.ts` at run time, so the
 *    walk can never silently fall behind the type again. The parse result is
 *    asserted against an expected count, because an empty walk that passes is
 *    a gate that cannot fail.
 *
 * 3. THE CONTENT SELECTOR. The old spec asserted on `main [data-testid]`.
 *    There is no `<main>` element in the app shell — the content slot is
 *    `#main-content` with `role="main"` (PersonasPage.tsx:388), and only four
 *    `<main>` tags exist anywhere in `src/`, all deep inside plugin sub-pages.
 *    So that assertion was matching whatever happened to be mounted, not the
 *    section under test.
 *
 * ── Known-uncovered (stated, not papered over) ──
 *
 * • `PluginTab` has 9 values; the bridge's `VALID_PLUGIN_TABS`
 *   (src/test/automation/bridge.ts:138) has 8 — **`scraper` is unreachable**
 *   from the bridge and is therefore not walked.
 * • `TeamsTab` (8), `OverviewTab` (15), `EditorTab` (8), `DevToolsTab` (7),
 *   `EventBusTab` (8), `ObsidianBrainTab` (6), `ResearchLabTab` (8),
 *   `HomeTab` (5), `TemplateTab` (5) have no bridge setter that this spec
 *   uses. `setTemplateTab` exists but covers 4 of TemplateTab's 5 values
 *   (`explore` is absent from its allow-list); it is left out rather than
 *   walked partially under a whole-union name.
 * • Tier/dev gates: `teams`, `events` and `plugins` are `minTier: TEAM` and
 *   `studio` is `devOnly` (sidebarData.ts). Under `tauri:dev:test` all four
 *   are reachable. If a gate does close one, the walk records it as GATED
 *   rather than failing — but only for those four, and the suite still
 *   requires a floor of sections actually walked, so "everything was gated"
 *   cannot pass.
 *
 * ── How the backend commands were chosen ──
 *
 * Every command below was picked by READING ITS RUST SIGNATURE AND BODY, not
 * by name. The filter was: registered in `generate_handler!` (src/lib.rs), no
 * required arguments beyond injected `State`, and a body that is a pure read —
 * a repo `get_all` / `list_*` SELECT, or an in-memory snapshot. Nothing that
 * writes, spawns a process, touches the network, or costs money. The per-
 * command justification is inline at each entry.
 */

const BASE = `http://127.0.0.1:${process.env.COMPANION_TEST_PORT ?? 17320}`;

// ── Union parsing (derive, never hard-code) ─────────────────────────────────

function repoRoot(): string {
  const here = path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'));
  return path.resolve(here, '..', '..');
}

/**
 * Pull a string-literal union out of `src/lib/types/types.ts`.
 * Throws loudly if the alias is missing or yields nothing — a parser failure
 * must never degrade into an empty (and therefore passing) walk.
 */
function parseUnion(alias: string): string[] {
  const file = path.join(repoRoot(), 'src', 'lib', 'types', 'types.ts');
  const src = fs.readFileSync(file, 'utf8');
  const m = new RegExp(`export type ${alias}\\s*=([^;]+);`).exec(src);
  if (!m) throw new Error(`parseUnion: no "export type ${alias} = ...;" in ${file}`);
  const values = Array.from(m[1].matchAll(/["']([^"']+)["']/g)).map((v) => v[1]);
  if (values.length === 0) {
    throw new Error(`parseUnion: matched "${alias}" but extracted 0 members from: ${m[1]}`);
  }
  return values;
}

/** Expected member counts, measured at master f6136d95b. A mismatch means the
 *  union changed (fine — update this) or the parser broke (not fine). Either
 *  way it must be loud, not silent. */
const EXPECTED = {
  SidebarSection: 11,
  SettingsTab: 13,
  PluginTab: 9,
  TwinTab: 7,
  ArtistTab: 3,
} as const;

/** Plugin tabs the bridge's allow-list cannot reach — see header. */
const PLUGIN_TABS_UNREACHABLE = ['scraper'];

/** Sections allowed to answer "gated" instead of rendering. */
const GATEABLE_SECTIONS = new Set(['teams', 'events', 'plugins', 'studio']);

/** Minimum sections that must actually be walked. Guards against a run where
 *  every section reports gated and the suite passes having proven nothing. */
const MIN_WALKED_SECTIONS = 7;

// ── Bridge plumbing ─────────────────────────────────────────────────────────

async function bridgeExec<T = unknown>(
  method: string,
  params: Record<string, unknown> = {},
  timeoutSecs = 30,
): Promise<T> {
  const res = await fetch(`${BASE}/bridge-exec`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ method, params, timeout_secs: timeoutSecs }),
  });
  if (!res.ok) {
    throw new Error(`POST /bridge-exec (${method}) → ${res.status}: ${await res.text()}`);
  }
  // The HTTP layer returns the bridge's reply as a JSON-encoded STRING, so a
  // successful call needs two parses (see CompanionBridge.bridgeExec). Unlike
  // that helper this one does NOT throw on an `error` field: `navigate` uses
  // `{ success: false, error }` to report a tier/dev gate, which this suite
  // classifies rather than treats as a fault.
  const text = await res.text();
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    return text as unknown as T;
  }
  if (typeof value === 'string') {
    // A genuine string result (not a nested JSON payload) stays as-is.
    const inner = value;
    try {
      value = JSON.parse(inner);
    } catch {
      value = inner;
    }
  }
  return value as T;
}

interface GateResult { success: boolean; error?: string; section?: string; tab?: string }

let app: CompanionBridge;

const settle = (ms = 350) => new Promise((r) => setTimeout(r, ms));

/**
 * Read the crash card. Returns its visible text (truncated by the bridge) when
 * the boundary is showing, or `null` when it isn't.
 */
async function crashCardText(): Promise<string | null> {
  const nodes = await app.query('[data-testid="error-boundary-fallback"]');
  if (nodes.length === 0) return null;
  return (nodes[0].text ?? '').replace(/\s+/g, ' ').trim().slice(0, 200) || '(crash card, no text)';
}

/** Assert the content slot mounted and rendered something. */
async function assertContentRendered(where: string): Promise<void> {
  const slot = await app.query('#main-content');
  expect(slot.length, `${where}: #main-content did not mount`).toBeGreaterThan(0);
  const text = (slot[0].text ?? '').trim();
  expect(text.length, `${where}: #main-content mounted but rendered no text`).toBeGreaterThan(0);
}

// ── Tests ───────────────────────────────────────────────────────────────────

test.describe('Module smoke', () => {
  test.setTimeout(180_000);

  test.beforeAll(async () => {
    app = bridge();
    const h = await app.health();
    expect(h.status).toBe('ok');
  });

  test('navigation unions parse to the expected size', () => {
    // This test exists so a PARSER failure is loud. Without it, a regex that
    // stopped matching would produce an empty walk that passes green.
    for (const [alias, count] of Object.entries(EXPECTED)) {
      const values = parseUnion(alias);
      expect(
        values.length,
        `${alias} parsed ${values.length} members (${values.join(', ')}), expected ${count}. ` +
          `Either the union changed — update EXPECTED — or parseUnion broke.`,
      ).toBe(count);
    }
  });

  test('every SidebarSection renders without the crash card', async () => {
    const sections = parseUnion('SidebarSection');
    expect(sections.length).toBe(EXPECTED.SidebarSection);

    const gated: string[] = [];
    let walked = 0;

    for (const section of sections) {
      const res = await bridgeExec<GateResult>('navigate', { section });

      if (!res.success) {
        // A tier/dev gate is an honest "not available in this build"; anything
        // else is a real navigation failure.
        const reason = res.error ?? '';
        const isGate = /requires tier|dev-only/i.test(reason);
        expect(
          isGate && GATEABLE_SECTIONS.has(section),
          `navigate("${section}") failed and it is not a known gate: ${reason}`,
        ).toBe(true);
        gated.push(section);
        continue;
      }

      await settle();

      const state = await bridgeExec<{ sidebarSection?: string }>('getState');
      expect(
        state.sidebarSection,
        `navigate("${section}") reported success but the store landed on "${state.sidebarSection}" ` +
          `— a redirect (usually a gate the bridge did not predict).`,
      ).toBe(section);

      const crash = await crashCardText();
      // FAIL FAST. The content area has a single boundary instance that does
      // not reset on navigation, so the FIRST crash poisons every later
      // section. Naming a later section would send someone to the wrong file.
      expect(
        crash,
        `CRASHED: section "${section}" rendered the error boundary. This is the FIRST ` +
          `section to crash — every section after it would show the same card retitled, ` +
          `so start here. Card text: ${crash}`,
      ).toBeNull();

      await assertContentRendered(`section "${section}"`);
      walked++;
    }

    console.log(`[module-smoke] sections walked=${walked} gated=${gated.join(',') || 'none'}`);
    expect(
      walked,
      `only ${walked} of ${sections.length} sections were actually walked (gated: ${gated.join(', ')}). ` +
        `A run where everything is gated proves nothing.`,
    ).toBeGreaterThanOrEqual(MIN_WALKED_SECTIONS);
  });

  test('every reachable L2 tab renders without the crash card', async () => {
    const settingsTabs = parseUnion('SettingsTab');
    const pluginTabs = parseUnion('PluginTab').filter((t) => !PLUGIN_TABS_UNREACHABLE.includes(t));
    const twinTabs = parseUnion('TwinTab');
    const artistTabs = parseUnion('ArtistTab');

    expect(settingsTabs.length).toBe(EXPECTED.SettingsTab);
    expect(pluginTabs.length).toBe(EXPECTED.PluginTab - PLUGIN_TABS_UNREACHABLE.length);
    expect(twinTabs.length).toBe(EXPECTED.TwinTab);
    expect(artistTabs.length).toBe(EXPECTED.ArtistTab);

    const stops: Array<{ id: string; open: () => Promise<unknown> }> = [
      // `openSettingsTab` sets the sidebar section itself, so no navigate needed.
      ...settingsTabs.map((tab) => ({
        id: `settings/${tab}`,
        open: () => bridgeExec<GateResult>('openSettingsTab', { tab }),
      })),
      ...pluginTabs.map((tab) => ({
        id: `plugins/${tab}`,
        open: async () => {
          await bridgeExec('navigate', { section: 'plugins' });
          return bridgeExec<GateResult>('setPluginTab', { tab });
        },
      })),
      // `setTwinTab` flips the plugin tab to `twin` for us.
      ...twinTabs.map((tab) => ({
        id: `twin/${tab}`,
        open: async () => {
          await bridgeExec('navigate', { section: 'plugins' });
          return bridgeExec<GateResult>('setTwinTab', { tab });
        },
      })),
      ...artistTabs.map((tab) => ({
        id: `artist/${tab}`,
        open: async () => {
          await bridgeExec('navigate', { section: 'plugins' });
          await bridgeExec('setPluginTab', { tab: 'artist' });
          return bridgeExec<GateResult>('setArtistTab', { tab });
        },
      })),
    ];

    let walked = 0;
    for (const stop of stops) {
      const res = (await stop.open()) as GateResult;
      if (res && res.success === false) {
        // The plugins section itself can be tier-gated; a setter that reports
        // an invalid tab is a real drift bug and must fail.
        const reason = res.error ?? '';
        expect(
          /requires tier|dev-only/i.test(reason),
          `${stop.id}: setter rejected the tab — ${reason}`,
        ).toBe(true);
        continue;
      }

      await settle(250);

      const crash = await crashCardText();
      expect(
        crash,
        `CRASHED: L2 tab "${stop.id}" rendered the error boundary. This is the FIRST tab to ` +
          `crash in this walk — later tabs inherit the same non-resetting boundary. ` +
          `Card text: ${crash}`,
      ).toBeNull();

      await assertContentRendered(`tab "${stop.id}"`);
      walked++;
    }

    console.log(`[module-smoke] L2 tabs walked=${walked} of ${stops.length}`);
    expect(walked, 'no L2 tab was walked').toBeGreaterThan(0);
  });

  /**
   * Backend liveness. Each entry is a REGISTERED, read-only, zero-argument
   * command; the note records why it is safe. If a `generate_handler!` entry
   * disappears, the invoke rejects with a "not allowed"/"unknown command"
   * error and this test names the command.
   */
  const READ_ONLY_COMMANDS: Array<{ command: string; module: string; why: string }> = [
    { command: 'get_persona_summaries', module: 'core/personas',
      why: 'body is `repo::get_summaries(&state.db)` — one SELECT, no writes.' },
    { command: 'list_credentials', module: 'credentials/crud',
      why: 'body is `repo::get_all(&state.db)`; the app itself calls it at startup. Returns stored rows, never decrypts a secret.' },
    { command: 'list_connectors', module: 'credentials/connectors',
      why: 'body is `repo::get_all(&state.db)`; public read used at startup.' },
    { command: 'list_all_triggers', module: 'tools/triggers',
      why: 'auth guard + `repo::get_all`. Listing a trigger never fires it.' },
    { command: 'list_known_event_types', module: 'communication/events',
      why: 'builtin vocabulary merged with a `SELECT DISTINCT event_type` — read-only (event_vocabulary.rs:231).' },
    { command: 'list_recipes', module: 'recipes/crud',
      why: 'auth guard + `repo::get_all`. Listing a recipe does not run it.' },
    { command: 'list_teams', module: 'teams/teams',
      why: 'auth guard + `repo::get_all`.' },
    { command: 'get_scheduler_status', module: 'execution/scheduler',
      why: '`Ok(state.scheduler.stats())` — an in-memory snapshot. Does NOT start the scheduler (that is `start_scheduler`, deliberately not used here).' },
    { command: 'list_tool_definitions', module: 'tools/tools',
      why: 'auth guard + `repo::get_all_definitions`. Definitions only — no tool is executed.' },
    { command: 'list_archetypes', module: 'design/archetypes',
      why: '`Ok(archetype_catalog::catalog().clone())` — a process-static catalog, no DB and no IO.' },
    { command: 'list_memory_categories', module: 'core/memories',
      why: '`all_category_info()` — a static enum listing, not user memories.' },
    { command: 'list_saved_views', module: 'core/saved_views',
      why: 'async auth + `saved_views::list_all` SELECT.' },
    { command: 'list_alert_rules', module: 'communication/observability',
      why: 'auth guard + `alert_repo::list_alert_rules` SELECT. Reading a rule does not evaluate it.' },
  ];

  test('read-only backend commands across every major module are registered and answer', async () => {
    const failures: string[] = [];
    for (const { command, module } of READ_ONLY_COMMANDS) {
      try {
        await app.invokeCommand(command);
      } catch (err) {
        failures.push(`${command} (${module}): ${err instanceof Error ? err.message : String(err)}`);
      }
    }
    expect(
      failures,
      `backend commands failed to answer:\n  ${failures.join('\n  ')}\n` +
        `A "not allowed"/unknown-command error means the command lost its ` +
        `generate_handler! registration; anything else is a runtime fault.`,
    ).toEqual([]);
    // Guard the guard: an empty list would make this test vacuous.
    expect(READ_ONLY_COMMANDS.length).toBeGreaterThanOrEqual(10);
  });

  test('navigation is reversible after the walk', async () => {
    expect(await bridgeExec<GateResult>('navigate', { section: 'home' })).toMatchObject({ success: true });
    await settle(200);
    expect(await crashCardText()).toBeNull();
  });
});
