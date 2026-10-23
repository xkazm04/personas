#!/usr/bin/env node
// The rail polish tape (spark mandate-lanes, polish P2): the mandate roof
// (`mandateRoofTape.mjs`: the real Classic fleet, its bays, the mandate lanes)
// plus the two reads the roof leaves empty, so the rail shows every plate it
// can draw:
//   - `fleet_scheduled_tasks`: four tasks with long titles (one running, one
//     off, two waiting), so the Schedules plate draws its two-row items;
//   - `fleet_claude_accounts_list` with three stored plans and
//     `fleet_cli_usage` (codex, agy's two model groups, grok not installed),
//     so the Usage plate has real rows to hover.
// Usage:
//   node scripts/style/page-harness/railPolishTape.mjs tmp/style-tapes/rail-polish.json
//   node scripts/style/shoot.mjs --module monitor/mandate-lanes/ticker --tape tmp/style-tapes/rail-polish.json \
//     --reduced-motion --settle 5000 --out <dir> --label rail
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildMandateRoofTape } from './mandateRoofTape.mjs';
import { RECORDED_AT } from './synthetic-tapes.mjs';

const T0 = Date.parse(RECORDED_AT);
const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;

const task = (name, title, over) => ({
  name, title, window: null, enabled: true, state: 'Ready', nextRunMs: null, lastRunMs: null, lastResult: null, ...over,
});

const TASKS = [
  task('CuratorNight', 'Curator night shift: conform the registry', {
    window: '23:00-07:00', nextRunMs: T0 + 5 * HOUR, lastRunMs: T0 - 19 * HOUR, lastResult: 0,
  }),
  task('VaultBackup', 'Nightly vault backup to the NAS share', {
    state: 'Running', nextRunMs: T0 + 23 * HOUR, lastRunMs: T0 - 4 * MIN, lastResult: 0,
  }),
  task('ReleaseSweep', 'Release sweep and changelog draft', {
    nextRunMs: T0 + 3 * DAY + 2 * HOUR, lastRunMs: T0 - 4 * DAY, lastResult: 1,
  }),
  task('GrowthDigest', 'Weekly growth digest for the board', { enabled: false, state: 'Disabled' }),
];

const win = (key, pct, resetsIn, windowMs) => ({ key, utilizationPct: pct, resetsAtMs: T0 + resetsIn, windowMs });
const FIVE_H = 5 * HOUR;
const WEEK = 7 * DAY;

const account = (id, email, slot, isActive, usage, over = {}) => ({
  id, email, displayName: null, organizationName: null, rateLimitTier: 'max', slot, isActive,
  quarantineReason: null, tokenExpiresAtMs: T0 + 6 * HOUR, usage, usageReason: null,
  usageFetchedAtMs: T0 - 3 * MIN, usageProjectedFromMs: null, lastSwitchedAtMs: null, login: null, relogin: null,
  ...over,
});

const ACCOUNTS = {
  activeAccountId: 'acc-1',
  liveEmail: 'ops@personas.dev',
  liveCaptured: true,
  livePresent: true,
  accounts: [
    account('acc-1', 'ops@personas.dev', 1, true, [
      win('five_hour', 62, 2 * HOUR + 14 * MIN, FIVE_H), win('seven_day', 41, 3 * DAY + 6 * HOUR, WEEK),
      win('seven_day_opus', 18, 3 * DAY + 6 * HOUR, WEEK),
    ]),
    account('acc-2', 'night@personas.dev', 2, false, [
      win('five_hour', 8, 4 * HOUR, FIVE_H), win('seven_day', 87, 1 * DAY + 3 * HOUR, WEEK),
    ], { usageFetchedAtMs: T0 - 41 * MIN }),
    account('acc-3', 'spare@personas.dev', 3, false, [
      win('five_hour', 0, 5 * HOUR, FIVE_H), win('seven_day', 12, 6 * DAY, WEEK),
    ], { usageFetchedAtMs: null, usageProjectedFromMs: T0 - 9 * HOUR }),
  ],
  autoRotate: { enabled: true, thresholdPct: 85, cooldownSecs: 600 },
  lastRotation: null,
  profiles: [],
};

const CLI = {
  providers: [
    {
      provider: 'codex', installed: true, version: '0.41.0', planType: 'pro',
      windows: [{ key: 'primary', windowMinutes: 10_080, usedPercent: 47, resetsAtMs: T0 + 2 * DAY + 6 * HOUR }],
      asOfMs: T0 - 3 * HOUR, projected: false, reason: null,
    },
    { provider: 'grok', installed: false, version: null, planType: null, windows: [], asOfMs: null, projected: false, reason: 'not_installed' },
    {
      provider: 'agy', installed: true, version: null, planType: null,
      windows: [
        { key: 'gemini-5h', windowMinutes: 300, usedPercent: 71, resetsAtMs: T0 + 84 * MIN, group: 'Gemini Models' },
        { key: 'gemini-weekly', windowMinutes: 10_080, usedPercent: 33, resetsAtMs: T0 + 4 * DAY, group: 'Gemini Models' },
        { key: '3p-5h', windowMinutes: 300, usedPercent: 0, resetsAtMs: T0 + 288 * MIN, group: 'Claude and GPT models' },
        { key: '3p-weekly', windowMinutes: 10_080, usedPercent: 8, resetsAtMs: T0 + 5 * DAY, group: 'Claude and GPT models' },
      ],
      asOfMs: T0 - MIN, projected: false, reason: null,
    },
  ],
};

const OWN = ['fleet_scheduled_tasks', 'fleet_claude_accounts_list', 'fleet_cli_usage'];

export function buildRailPolishTape() {
  const roof = buildMandateRoofTape();
  return {
    ...roof,
    note: `${roof.note} Plus four scheduled tasks, three stored Claude plans and the CLI usage read (railPolishTape.mjs).`,
    calls: [
      ...roof.calls.filter((c) => !OWN.includes(c.cmd)),
      { cmd: 'fleet_scheduled_tasks', response: TASKS },
      { cmd: 'fleet_claude_accounts_list', response: ACCOUNTS },
      { cmd: 'fleet_cli_usage', response: CLI },
    ],
  };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const out = resolve(process.argv[2] ?? 'tmp/style-tapes/rail-polish.json');
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, JSON.stringify(buildRailPolishTape(), null, 2));
  console.log(`wrote ${out}`);
}
