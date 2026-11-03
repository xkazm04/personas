// @vitest-environment node
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const invokeWithTimeout = vi.fn();
vi.mock('@/lib/tauriInvoke', () => ({
  invokeWithTimeout: (...a: unknown[]) => invokeWithTimeout(...a),
}));

import { getHealthBundle } from '@/api/overview/health';
import { getSlaDashboard } from '@/api/overview/sla';
import {
  getAllMonthlySpend,
  getExecutionHeatmap,
  getOverviewBundle,
} from '@/api/overview/observability';

/** Every overview command whose wrapper sends the user's UTC offset, and the
 *  argument it carries it in. This pins the WIRE, not bucketing: four bucket
 *  by local day, but get_all_monthly_spend deliberately ignores the offset and
 *  uses a UTC month so the budget UI matches the server's budget gate
 *  (src-tauri/src/commands/communication/observability/metrics.rs,
 *  get_all_monthly_spend_with_conn). */
const CASES: Array<[string, () => Promise<unknown>, string]> = [
  ['get_health_bundle', () => getHealthBundle(), 'utcOffsetMinutes'],
  ['get_sla_dashboard', () => getSlaDashboard(30), 'utcOffsetMinutes'],
  ['get_all_monthly_spend', () => getAllMonthlySpend(), 'utcOffsetMinutes'],
  ['get_overview_bundle', () => getOverviewBundle(30, 'p-offset-test'), 'utcOffsetMinutes'],
  ['get_execution_heatmap', () => getExecutionHeatmap(30), 'tzOffsetMinutes'],
];

/**
 * The ground truth CASES must cover: every `#[tauri::command]` under
 * src-tauri/src/commands that declares a `utc_offset_minutes` or
 * `tz_offset_minutes` parameter (comments stripped). Without this, a new
 * local-day command whose wrapper gets the sign wrong is simply not in the
 * list above, and this file stays green.
 */
function rustOffsetCommands(): string[] {
  const root = resolve(__dirname, '../../..', 'src-tauri/src/commands');
  const found = new Set<string>();
  const walk = (dir: string) => {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      const p = join(dir, e.name);
      if (e.isDirectory()) walk(p);
      else if (e.name.endsWith('.rs')) {
        const src = readFileSync(p, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
        // Lazy skip to the nearest fn: other attributes, some multi-line
        // (#[instrument(...)]), may sit between the command marker and it.
        const re = /#\[tauri::command[^\]]*\][\s\S]*?\bfn\s+(\w+)\s*\(([\s\S]*?)\)\s*->/g;
        for (const m of src.matchAll(re)) {
          if (/\b(?:utc|tz)_offset_minutes\s*:/.test(m[2]!)) found.add(m[1]!);
        }
      }
    }
  };
  walk(root);
  return [...found].sort();
}

describe('local-day offset: CASES covers every Rust command that takes an offset', () => {
  it('the CASES command set equals the Rust commands declaring (utc|tz)_offset_minutes', () => {
    const rust = rustOffsetCommands();
    expect(rust.length, 'found no offset-taking commands (vacuous pin)').toBeGreaterThan(0);
    expect(CASES.map(([cmd]) => cmd).sort()).toEqual(rust);
  });
});

describe('local-day offset: every overview command sends minutes EAST of UTC', () => {
  beforeEach(() => {
    invokeWithTimeout.mockReset();
    invokeWithTimeout.mockResolvedValue({});
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  for (const [tzOffset, expected] of [[-120, 120], [300, -300]] as const) {
    it(`getTimezoneOffset() = ${tzOffset} -> ${expected} on all ${CASES.length} commands`, async () => {
      vi.spyOn(Date.prototype, 'getTimezoneOffset').mockReturnValue(tzOffset);
      for (const [cmd, call, arg] of CASES) {
        invokeWithTimeout.mockClear();
        await call();
        const sent = invokeWithTimeout.mock.calls.find((c) => c[0] === cmd);
        expect(sent, cmd).toBeDefined();
        expect((sent![1] as Record<string, unknown>)[arg], cmd).toBe(expected);
      }
    });
  }
});
