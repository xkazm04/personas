/**
 * Discord ↔ Twin — UI-driven setup.
 *
 * Runs BEFORE `discord-twin-2-replier.spec.ts`. It provisions everything the
 * reply-loop test needs, and does the credential half by driving the real
 * app UI through testIds (not back-door SQL):
 *
 *   1. Navigate to Connections → Catalog, open the Discord connector card,
 *      type the bot token into the credential form, run the live
 *      healthcheck, and Save. → a real `discord` credential in the vault.
 *   2. Resolve the active Twin profile.
 *   3. Provision the "Discord Twin" persona via the test bridge
 *      (`setupDiscordTwinPersona`) — an enabled persona with a Discord
 *      `notification_channels` entry carrying `config.pollInbound = true`
 *      and `config.channelId`, pinned to the Twin profile.
 *
 * Why the persona half isn't UI-driven: creating a persona from scratch
 * goes through the AI build-session flow in the glyph editor — a slow,
 * non-deterministic surface unfit for a setup step. The bridge method is
 * still part of the test suite; it just writes the row deterministically.
 *
 * ## Pre-reqs
 *   - App running with the test-automation server:  npm run tauri:dev:test
 *   - Env (loaded from .env — see playwright config / your shell):
 *       DISCORD_BOT_TOKEN, DISCORD_TEST_CHANNEL_ID, DISCORD_PERSONA_NAME
 *
 * Run:  npx playwright test discord-twin-1-setup
 */

import { test, expect } from '@playwright/test';

const PORT = Number(process.env.COMPANION_TEST_PORT ?? 17320);
const BRIDGE = `http://127.0.0.1:${PORT}`;

const BOT_TOKEN = process.env.DISCORD_BOT_TOKEN ?? '';
const CHANNEL_ID = process.env.DISCORD_TEST_CHANNEL_ID ?? '';
const PERSONA_NAME = process.env.DISCORD_PERSONA_NAME ?? 'Discord Twin';

test.beforeAll(() => {
  if (!BOT_TOKEN || !CHANNEL_ID) {
    test.skip(
      true,
      'Set DISCORD_BOT_TOKEN and DISCORD_TEST_CHANNEL_ID (see .env) to run Discord setup. Skipping.',
    );
  }
});

// ── HTTP primitives against the test-automation server ──────────────

async function post<T = unknown>(path: string, body: unknown = {}): Promise<T> {
  const res = await fetch(`${BRIDGE}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    throw new Error(`POST ${path} → ${res.status}: ${(await res.text()).slice(0, 200)}`);
  }
  const text = await res.text();
  try {
    return JSON.parse(text) as T;
  } catch {
    return text as unknown as T;
  }
}

async function navigate(section: string): Promise<void> {
  await post('/navigate', { section });
}

async function clickTestId(testId: string): Promise<void> {
  await post('/click-testid', { test_id: testId });
}

async function fillField(testId: string, value: string): Promise<void> {
  await post('/fill-field', { test_id: testId, value });
}

interface QueryNode {
  tag: string;
  testId: string | null;
  text: string;
  visible: boolean;
}

async function query(selector: string): Promise<QueryNode[]> {
  return post<QueryNode[]>('/query', { selector });
}

async function bridgeExec<T = unknown>(
  method: string,
  params: Record<string, unknown> = {},
): Promise<T> {
  const raw = await post<string>('/bridge-exec', { method, params, timeout_secs: 30 });
  const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw;
  if (parsed && typeof parsed === 'object' && 'error' in parsed && parsed.error) {
    throw new Error(`bridge ${method}: ${parsed.error}`);
  }
  return parsed as T;
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

interface CredentialRow {
  id: string;
  name: string;
  serviceType: string;
}

async function listCredentials(): Promise<CredentialRow[]> {
  const r = await bridgeExec<{ success: boolean; credentials?: CredentialRow[] }>(
    'listCredentials',
  );
  return r.credentials ?? [];
}

// ── The spec ────────────────────────────────────────────────────────

test('UI-driven Discord credential + Discord Twin persona setup', async () => {
  test.setTimeout(120_000);

  // 0. Bridge up. `/health` is a GET route.
  const healthRes = await fetch(`${BRIDGE}/health`);
  const health = (await healthRes.json()) as { status: string };
  expect(health.status, 'test-automation server not ready — run `npm run tauri:dev:test`').toBe(
    'ok',
  );

  // ── 1. Discord credential, driven through the catalog UI ───────────
  let discordCred = (await listCredentials()).find((c) => c.serviceType === 'discord');

  if (discordCred) {
    // eslint-disable-next-line no-console
    console.log(`[setup] reusing existing Discord credential ${discordCred.id}`);
  } else {
    // eslint-disable-next-line no-console
    console.log('[setup] creating Discord credential through the catalog UI…');

    await navigate('credentials');
    await sleep(800);

    // Connections → Catalog tab.
    await clickTestId('tab-from-template');
    await sleep(1200);

    // Open the Discord connector card.
    const cards = await query('[data-testid="catalog-connector-discord"]');
    expect(cards.length, 'Discord connector card not found in catalog').toBeGreaterThan(0);
    await clickTestId('catalog-connector-discord');
    await sleep(1200);

    // Type the bot token into the credential form field.
    const fields = await query('[data-testid="vault-field-bot_token-input"]');
    expect(fields.length, 'bot_token field not rendered on the Discord form').toBeGreaterThan(0);
    await fillField('vault-field-bot_token-input', BOT_TOKEN);
    await sleep(400);

    // Run the live healthcheck (Discord GET /users/@me) — Save is gated on it.
    await clickTestId('vault-test-connection');

    // Poll: once the healthcheck passes, Save is enabled. We click Save on
    // each tick; while it's still disabled the click is a harmless no-op.
    // Done when the credential shows up in the vault.
    const deadline = Date.now() + 45_000;
    while (Date.now() < deadline) {
      await sleep(2500);
      await clickTestId('vault-schema-save');
      await sleep(1200);
      discordCred = (await listCredentials()).find((c) => c.serviceType === 'discord');
      if (discordCred) break;
    }
    expect(
      discordCred,
      'Discord credential never landed — healthcheck may have failed (bad token / no Read perm) or Save stayed disabled.',
    ).toBeTruthy();
    // eslint-disable-next-line no-console
    console.log(`[setup] Discord credential created: ${discordCred!.id}`);
  }

  // ── 2. Resolve the active Twin profile ─────────────────────────────
  const twin = await bridgeExec<{
    success: boolean;
    twinProfileId: string | null;
    twinName: string | null;
  }>('getActiveTwinProfileId');
  if (twin.twinProfileId) {
    // eslint-disable-next-line no-console
    console.log(`[setup] pinning persona to Twin "${twin.twinName}" (${twin.twinProfileId})`);
  } else {
    // eslint-disable-next-line no-console
    console.log('[setup] no Twin profile found — persona will run without a Twin pin');
  }

  // ── 3. Provision the Discord Twin persona ──────────────────────────
  const result = await bridgeExec<{
    success: boolean;
    personaId?: string;
    personaName?: string;
    error?: string;
  }>('setupDiscordTwinPersona', {
    name: PERSONA_NAME,
    discordCredentialId: discordCred!.id,
    channelId: CHANNEL_ID,
    twinProfileId: twin.twinProfileId ?? undefined,
  });
  expect(result.success, `persona provisioning failed: ${result.error ?? ''}`).toBe(true);
  expect(result.personaId, 'no persona id returned').toBeTruthy();
  // eslint-disable-next-line no-console
  console.log(
    `[setup] persona "${result.personaName}" ready (id=${result.personaId}) — polling #${CHANNEL_ID}`,
  );

  // Refresh the personas list in the webview so a human can see it.
  await post('/refresh-personas').catch(() => {});
});
