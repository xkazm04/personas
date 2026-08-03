/**
 * Auto deep-scan policy (scan consolidation Tier 2).
 *
 * When a sweep's outbox ingest returns NEW escalations, the app auto-spawns a
 * focused `/scan-<lens> <context>` Fleet session per entry — bounded per
 * ingest, and killable at runtime via this persisted toggle (surfaced in the
 * Coverage Pipeline). Lives in `lib/` so both the fleet store slice and the
 * dev-tools UI can import it without a stores↔features cycle.
 */

import { silentCatch } from '@/lib/silentCatch';

const STORAGE_KEY = 'personas.autoDeepScan';

/** Hard bound on auto-spawned deep scans per single outbox ingest. */
export const MAX_AUTO_DEEP_SCANS_PER_INGEST = 2;

/** Default ON — the operator opted into Tier 2 by dispatching sweeps; the
 *  escalation dedup key already throttles repeats to one per lens×context. */
export function isAutoDeepScanEnabled(): boolean {
  try {
    return localStorage.getItem(STORAGE_KEY) !== 'off';
  } catch {
    return true;
  }
}

export function setAutoDeepScanEnabled(on: boolean): void {
  try {
    localStorage.setItem(STORAGE_KEY, on ? 'on' : 'off');
  } catch (e) {
    // Storage unavailable (private mode): the default stays in effect.
    silentCatch('scanSweep:persistAutoToggle')(e);
  }
}

/** The slash command a deep-scan escalation resolves to. */
export function deepScanCommand(lens: string, context: string | null): string {
  return context ? `/scan-${lens} ${context}` : `/scan-${lens}`;
}
