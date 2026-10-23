#!/usr/bin/env node
// The persona-card variants tape (spark mandate-lanes, WP11 phase A): WP10's
// mandate roof (`mandateRoofTape.mjs`: the real Classic fleet, its bays, the
// rail plates, the mandate lanes) with the fleet REBALANCED so every card
// state the variants must answer is on screen at once. On the roof tape 22 of
// 30 personas carry unread reports, so the board is one state; here eight do.
// Every value a card prints comes from a read the board already makes, except
// `list_cron_agents` (the next schedule), which only the Schedules overlay
// reads today: the variants module fetches it in `prepare` and the README
// names it as the one read phase B adds.
//
//   needs you  unread reports on 8 personas, one review waiting (warning)
//   critical   Invoice Reconciler's last run failed; DNS Auditor holds a critical review
//   working    three runs (personaCardVariants.tsx `prepare`), one more queued
//   idle       the rest, with a last run (outcome + age) from get_persona_summaries
//   off        five personas switched off
//   scheduled  eight enabled cron triggers with a next start
//   never ran  Vendor Onboarder (no summary row)
//
//   node scripts/style/page-harness/personaCardVariantsTape.mjs <out.json>
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildMandateRoofTape } from './mandateRoofTape.mjs';
import { RECORDED_AT } from './synthetic-tapes.mjs';

const T0 = Date.parse(RECORDED_AT);
const at = (minutes) => new Date(T0 + minutes * 60_000).toISOString();
const pid = (i) => `p-board-${i}`;

/** Persona index -> unread reports (the needs-you amber). */
const UNREAD = { 0: 12, 2: 4, 4: 3, 9: 2, 12: 7, 17: 1, 19: 5, 24: 2 };
/** Persona index -> review severity. */
const REVIEWS = { 3: 'warning', 16: 'critical' };
/** Persona index -> minutes until the next cron start. */
const NEXT = { 1: 25, 5: 140, 8: 60 * 9, 13: 45, 14: 60 * 30, 18: 12, 21: 60 * 5, 26: 60 * 26 };

function cronAgent(i, name, minutes) {
  return {
    persona_id: pid(i), persona_name: name, persona_icon: null, persona_color: null, persona_enabled: true, headless: false,
    trigger_id: `tr-${i}`, cron_expression: '0 * * * *', interval_seconds: null, timezone: null, trigger_enabled: true,
    last_triggered_at: at(-60 * 3), next_trigger_at: at(minutes), description: '', recent_executions: 2, recent_failures: 0,
  };
}

export function buildPersonaCardVariantsTape() {
  const roof = buildMandateRoofTape();
  // The engine's 20-minute run cap as each persona's timeout: the instrument card draws a run against it.
  const personas = roof.calls.find((c) => c.cmd === 'list_personas').response.map((p) => ({ ...p, timeout_ms: 1_200_000 }));
  const swap = (calls, cmd, response) => [...calls.filter((c) => c.cmd !== cmd), { cmd, response }];
  let calls = swap(roof.calls, 'list_personas', personas);
  calls = swap(calls, 'get_unread_report_counts_by_persona', Object.fromEntries(Object.entries(UNREAD).map(([i, n]) => [pid(Number(i)), n])));
  const reviewCounts = Object.entries(REVIEWS).map(([i, sev]) => ({
    personaId: pid(Number(i)), pending: 1, critical: sev === 'critical' ? 1 : 0, warning: sev === 'warning' ? 1 : 0, info: 0,
  }));
  calls = swap(calls, 'get_pending_review_counts_by_persona', reviewCounts);
  // Vendor Onboarder has never run: no summary row, so its card has no last run.
  const summaries = roof.calls.find((c) => c.cmd === 'get_persona_summaries').response.filter((s) => s.personaId !== pid(29));
  calls = swap(calls, 'get_persona_summaries', summaries);
  const cron = Object.entries(NEXT).map(([i, minutes]) => cronAgent(Number(i), personas[Number(i)].name, minutes));
  calls = [...calls, { cmd: 'list_cron_agents', response: cron }];
  return {
    ...roof,
    note: `${roof.note} Rebalanced for the persona-card variants (personaCardVariantsTape.mjs): 8 unread, a warning and a critical review, a failed last run, 8 cron schedules, one persona that never ran.`,
    calls,
  };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const out = resolve(process.argv[2] ?? 'tmp/style-tapes/persona-cards.json');
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, JSON.stringify(buildPersonaCardVariantsTape(), null, 2));
  console.log(`wrote ${out}`);
}
