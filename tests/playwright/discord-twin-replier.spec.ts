/**
 * Discord ↔ Twin reply loop — end-to-end smoke (human-in-the-loop).
 *
 * Why human-in-the-loop: `engine/discord_poller.rs` filters out
 * bot-authored messages by design so a bot reply doesn't trigger another
 * persona run (infinite loop). The cleanest way to exercise the inbound
 * path is for *you* to type the prompt in Discord while this spec
 * watches. It's also exactly the scenario the user owns end-to-end —
 * "I will write in specific channel, persona will receive event or
 * poll messages, and executes by replying".
 *
 * ## Pre-reqs (one-time setup)
 *
 * 1. Discord bot in a test channel; channel writable by the bot.
 * 2. A persona in the app whose `notification_channels` include an
 *    enabled Discord entry with `config.pollInbound = true` and
 *    `config.channelId = <test channel id>`. Optionally attach a Twin
 *    binding via `credential_links["twin"]`.
 * 3. App running with the test-automation HTTP server:
 *      npm run tauri:dev:test
 *
 * ## Required env vars
 *
 * - DISCORD_BOT_TOKEN           Bot token (read perm on the channel).
 * - DISCORD_TEST_CHANNEL_ID     Channel id where you'll type the prompt.
 * - DISCORD_PERSONA_NAME        Persona name (resolved to id via bridge).
 * - DISCORD_USER_AUTHOR_ID      Your Discord user id — used to scope the
 *                               watcher so we don't catch the bot's
 *                               own messages or someone else's traffic.
 *
 * ## Optional
 *
 * - DISCORD_PROMPT_HINT         What to print as the cue. Default:
 *                               "ping {timestamp}".
 * - DISCORD_WAIT_PROMPT_MS      How long to wait for you to type
 *                               (default 60s).
 * - DISCORD_WAIT_REPLY_MS       How long to wait for the bot reply
 *                               (default 180s — real Claude run + post).
 * - COMPANION_TEST_PORT         App test-automation port (default 17320).
 *
 * Run with:
 *   DISCORD_BOT_TOKEN=... DISCORD_TEST_CHANNEL_ID=... \
 *   DISCORD_PERSONA_NAME='Discord Twin' DISCORD_USER_AUTHOR_ID=... \
 *   npx playwright test discord-twin-replier
 */

import { test, expect } from '@playwright/test';

const DISCORD_API = 'https://discord.com/api/v10';
const PORT = Number(process.env.COMPANION_TEST_PORT ?? 17320);
const BRIDGE = `http://127.0.0.1:${PORT}`;

const BOT_TOKEN = process.env.DISCORD_BOT_TOKEN ?? '';
const CHANNEL_ID = process.env.DISCORD_TEST_CHANNEL_ID ?? '';
const PERSONA_NAME = process.env.DISCORD_PERSONA_NAME ?? '';
const USER_AUTHOR_ID = process.env.DISCORD_USER_AUTHOR_ID ?? '';
const PROMPT_HINT = process.env.DISCORD_PROMPT_HINT ?? `ping ${Date.now()}`;
const WAIT_PROMPT_MS = Number(process.env.DISCORD_WAIT_PROMPT_MS ?? 60_000);
const WAIT_REPLY_MS = Number(process.env.DISCORD_WAIT_REPLY_MS ?? 180_000);
const POLL_INTERVAL_MS = 3_000;

test.beforeAll(() => {
  if (!BOT_TOKEN || !CHANNEL_ID || !PERSONA_NAME || !USER_AUTHOR_ID) {
    test.skip(
      true,
      'Set DISCORD_BOT_TOKEN, DISCORD_TEST_CHANNEL_ID, DISCORD_PERSONA_NAME, DISCORD_USER_AUTHOR_ID to run the Discord smoke. Skipping.',
    );
  }
});

// ── Bridge / Discord helpers ────────────────────────────────────────

async function bridgeExec<T = unknown>(
  method: string,
  params: Record<string, unknown> = {},
): Promise<T> {
  const res = await fetch(`${BRIDGE}/bridge-exec`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ method, params, timeout_secs: 30 }),
  });
  if (!res.ok) throw new Error(`bridge-exec ${method}: HTTP ${res.status}`);
  const parsed = JSON.parse(await res.text());
  if (parsed && typeof parsed === 'object' && 'error' in parsed && parsed.error) {
    throw new Error(`bridge-exec ${method}: ${parsed.error}`);
  }
  return parsed as T;
}

interface DiscordMessage {
  id: string;
  content: string;
  author: { id: string; username: string; bot?: boolean };
  message_reference?: { message_id?: string };
  timestamp: string;
}

async function discordFetchMessages(): Promise<DiscordMessage[]> {
  const res = await fetch(
    `${DISCORD_API}/channels/${CHANNEL_ID}/messages?limit=50`,
    {
      headers: {
        Authorization: `Bot ${BOT_TOKEN}`,
        'User-Agent': 'PersonasPlaywright/1.0',
      },
    },
  );
  if (!res.ok) {
    throw new Error(
      `Discord GET messages ${res.status}: ${(await res.text()).slice(0, 200)}`,
    );
  }
  return (await res.json()) as DiscordMessage[];
}

async function resolvePersonaIdByName(name: string): Promise<string> {
  const result = await bridgeExec<{
    success: boolean;
    personas?: Array<{ id: string; name: string }>;
    error?: string;
  }>('listPersonas');
  if (!result.success || !result.personas) {
    throw new Error(`listPersonas failed: ${result.error ?? 'unknown'}`);
  }
  const match = result.personas.find((p) => p.name === name);
  if (!match) {
    throw new Error(
      `Persona "${name}" not found. Known: ${result.personas.map((p) => p.name).join(', ')}`,
    );
  }
  return match.id;
}

interface ExecutionRow {
  id: string;
  status: string;
  input_data?: string | null;
  output_data?: string | null;
}

async function findExecutionByMessageId(
  personaId: string,
  messageId: string,
): Promise<ExecutionRow | null> {
  const result = await bridgeExec<{
    success: boolean;
    executions?: ExecutionRow[];
    error?: string;
  }>('getPersonaArtifacts', { personaId });
  if (!result.success || !result.executions) return null;
  for (const exec of result.executions) {
    if (!exec.input_data) continue;
    try {
      const parsed = JSON.parse(exec.input_data) as Record<string, unknown>;
      if (parsed.messageId === messageId) return exec;
    } catch {
      // not JSON — skip
    }
  }
  return null;
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

// ── Spec ────────────────────────────────────────────────────────────

test('discord poller picks up user message, persona replies', async () => {
  // 0. Sanity-check the test bridge.
  const health = (await (await fetch(`${BRIDGE}/health`)).json()) as { status: string };
  expect(health.status, 'test-automation HTTP server not ready').toBe('ok');

  // 1. Resolve the persona.
  const personaId = await resolvePersonaIdByName(PERSONA_NAME);
  // eslint-disable-next-line no-console
  console.log(`[discord-smoke] persona "${PERSONA_NAME}" → id=${personaId}`);
  // eslint-disable-next-line no-console
  console.log(
    `\n[discord-smoke] Now go to Discord and post this in <#${CHANNEL_ID}>:\n  ${PROMPT_HINT}\n`,
  );

  // 2. Wait for your message to land.
  const watchStart = Date.now();
  let userMessage: DiscordMessage | null = null;
  while (Date.now() - watchStart < WAIT_PROMPT_MS) {
    const recent = await discordFetchMessages();
    userMessage = recent.find(
      (m) =>
        m.author.id === USER_AUTHOR_ID &&
        !m.author.bot &&
        m.content.includes(PROMPT_HINT) &&
        new Date(m.timestamp).getTime() >= watchStart,
    ) ?? null;
    if (userMessage) break;
    await sleep(POLL_INTERVAL_MS);
  }
  expect(
    userMessage,
    `Didn't see your message containing "${PROMPT_HINT}" in #${CHANNEL_ID} within ${WAIT_PROMPT_MS}ms. Make sure DISCORD_USER_AUTHOR_ID matches the account you typed from.`,
  ).toBeTruthy();
  const userMessageId = userMessage!.id;
  // eslint-disable-next-line no-console
  console.log(`[discord-smoke] saw your message id=${userMessageId}`);

  // 3. Poll for the persona execution to fire and complete.
  const replyStart = Date.now();
  let execution: ExecutionRow | null = null;
  while (Date.now() - replyStart < WAIT_REPLY_MS) {
    execution = await findExecutionByMessageId(personaId, userMessageId);
    if (execution && execution.status === 'completed') break;
    if (execution && execution.status === 'failed') break;
    await sleep(POLL_INTERVAL_MS);
  }
  expect(
    execution,
    `No persona_execution for messageId=${userMessageId} after ${WAIT_REPLY_MS}ms. Check: persona has config.pollInbound=true on the Discord channel; persona is enabled; bot token has Read Message History.`,
  ).toBeTruthy();
  expect(execution!.status, `execution status=${execution!.status}`).toBe('completed');
  // eslint-disable-next-line no-console
  console.log(`[discord-smoke] execution ${execution!.id} completed`);

  // 4. Verify the bot replied in Discord with a message_reference to ours.
  const recent = await discordFetchMessages();
  const reply = recent.find(
    (m) => m.message_reference?.message_id === userMessageId && m.author.bot,
  );
  expect(reply, 'Bot reply not found in last 50 messages').toBeTruthy();
  expect(reply!.content.length, 'Reply was empty').toBeGreaterThan(0);
  // eslint-disable-next-line no-console
  console.log(`[discord-smoke] bot replied: ${reply!.content.slice(0, 80)}…`);
});
