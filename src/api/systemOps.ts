/**
 * System-operation automations — IPC wrappers.
 *
 * A system-op automation binds a trigger (schedule cron OR event listener) to a
 * built-in backend operation that is NOT a persona execution (first op:
 * `context_scan`). Powers the Chain Studio "System events" rail (a committed
 * route = one automation) and the Context Map "Plan update" button.
 */
import { invokeWithTimeout as invoke } from '@/lib/tauriInvoke';
import type { SystemOpAutomation } from '@/lib/bindings/SystemOpAutomation';
import type { SystemOpKindMeta } from '@/lib/bindings/SystemOpKindMeta';

export type { SystemOpAutomation } from '@/lib/bindings/SystemOpAutomation';
export type { SystemOpKindMeta } from '@/lib/bindings/SystemOpKindMeta';

/** Op key for the dev-tools context-map scan (the first system operation). */
export const OP_CONTEXT_SCAN = 'context_scan';

/** Catalog of available system operations (drives the Studio target rail). */
export const listSystemOpKinds = () =>
  invoke<SystemOpKindMeta[]>('system_ops_list_kinds');

/** All persisted automations. */
export const listSystemOpAutomations = () =>
  invoke<SystemOpAutomation[]>('system_ops_list_automations');

export interface CreateAutomationInput {
  opKind: string;
  /** JSON-encoded op params, e.g. `{"projectId":"…","deltaMode":true}`. */
  paramsJson: string;
  /** 'schedule' | 'event'. */
  triggerKind: 'schedule' | 'event';
  cron?: string;
  timezone?: string;
  listenEventType?: string;
  sourceFilter?: string;
  label?: string;
}

export const createSystemOpAutomation = (input: CreateAutomationInput) =>
  invoke<SystemOpAutomation>('system_ops_create_automation', {
    opKind: input.opKind,
    paramsJson: input.paramsJson,
    triggerKind: input.triggerKind,
    cron: input.cron,
    timezone: input.timezone,
    listenEventType: input.listenEventType,
    sourceFilter: input.sourceFilter,
    label: input.label,
  });

export const setSystemOpAutomationEnabled = (id: string, enabled: boolean) =>
  invoke<boolean>('system_ops_set_enabled', { id, enabled });

export const deleteSystemOpAutomation = (id: string) =>
  invoke<boolean>('system_ops_delete_automation', { id });

/** Run an automation's operation immediately (does not change its schedule). */
export const runSystemOpNow = (id: string) =>
  invoke<string>('system_ops_run_now', { id });

// ---------------------------------------------------------------------------
// Convenience builders for the context-scan op (always scoped to one project)
// ---------------------------------------------------------------------------

/** Default cadence for the Context Map "Plan update" button: Mondays 03:00. */
export const WEEKLY_CONTEXT_SCAN_CRON = '0 3 * * 1';

export const contextScanParamsJson = (projectId: string, deltaMode = true): string =>
  JSON.stringify({ projectId, deltaMode });

/** Create a weekly context-scan schedule for a project (Plan update button). */
export const planWeeklyContextScan = (projectId: string, projectName?: string) =>
  createSystemOpAutomation({
    opKind: OP_CONTEXT_SCAN,
    paramsJson: contextScanParamsJson(projectId, true),
    triggerKind: 'schedule',
    cron: WEEKLY_CONTEXT_SCAN_CRON,
    label: projectName ? `Weekly context scan — ${projectName}` : 'Weekly context scan',
  });
