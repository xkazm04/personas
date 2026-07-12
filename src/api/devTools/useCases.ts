// Use-case slice layer (docs/plans/use-case-slice-layer.md) — wrappers over the
// dev_tools_*_use_case* Tauri commands.
//
// A use case is a behavioral unit that slices *through* contexts rather than
// subdividing one, and is the narrowest scope a KPI can own. `slug` is the join
// key an LLM-observability pinpoint's use-case name is matched against.
import { invokeWithTimeout as invoke } from "@/lib/tauriInvoke";

import type { DevUseCase } from "@/lib/bindings/DevUseCase";

/** 'user_flow' | 'capability' | 'integration' | 'ops' */
export const USE_CASE_KINDS = ["user_flow", "capability", "integration", "ops"] as const;
export type UseCaseKind = (typeof USE_CASE_KINDS)[number];

/** 'proposed' | 'active' | 'archived' */
export type UseCaseStatus = "proposed" | "active" | "archived";

export async function listUseCases(
  projectId: string,
  status?: UseCaseStatus,
): Promise<DevUseCase[]> {
  return invoke<DevUseCase[]>("dev_tools_list_use_cases", { projectId, status });
}

export async function getUseCase(id: string): Promise<DevUseCase> {
  return invoke<DevUseCase>("dev_tools_get_use_case", { id });
}

/** Every non-archived use case whose slice includes this context. */
export async function listUseCasesForContext(contextId: string): Promise<DevUseCase[]> {
  return invoke<DevUseCase[]>("dev_tools_list_use_cases_for_context", { contextId });
}

export interface CreateUseCaseInput {
  projectId: string;
  name: string;
  description?: string;
  kind?: UseCaseKind;
  primaryContextId?: string;
  contextIds?: string[];
  status?: UseCaseStatus;
  createdBy?: string;
  rationale?: string;
}

export async function createUseCase(input: CreateUseCaseInput): Promise<DevUseCase> {
  return invoke<DevUseCase>("dev_tools_create_use_case", { ...input });
}

/** Field-wise update. `null` clears a nullable column; `undefined` leaves it
 * unchanged. `contextIds` replaces the whole slice. */
export interface UpdateUseCaseInput {
  name?: string;
  description?: string | null;
  kind?: UseCaseKind;
  primaryContextId?: string | null;
  status?: UseCaseStatus;
  pinned?: boolean;
  contextIds?: string[];
}

export async function updateUseCase(
  id: string,
  updates: UpdateUseCaseInput,
): Promise<DevUseCase> {
  return invoke<DevUseCase>("dev_tools_update_use_case", { id, ...updates });
}

export async function deleteUseCase(id: string): Promise<boolean> {
  return invoke<boolean>("dev_tools_delete_use_case", { id });
}

/** Deterministic seed (no LLM): promote each distinct `business_feature` label
 * on the context map into a `proposed` use case. Idempotent. */
export async function backfillUseCases(projectId: string): Promise<DevUseCase[]> {
  return invoke<DevUseCase[]>("dev_tools_backfill_use_cases", { projectId }, { timeoutMs: 60_000 });
}

/** Start a use-case proposal scan; progress streams via USE_CASE_SCAN_* events. */
export async function scanUseCases(projectId: string): Promise<{ scan_id: string }> {
  return invoke<{ scan_id: string }>("dev_tools_scan_use_cases", { projectId }, { timeoutMs: 30_000 });
}

export async function cancelUseCaseScan(scanId: string): Promise<boolean> {
  return invoke<boolean>("dev_tools_cancel_use_case_scan", { scanId });
}

export async function getUseCaseScanStatus(scanId: string): Promise<{
  scan_id: string;
  status: string;
  error?: string | null;
  lines?: string[];
}> {
  return invoke("dev_tools_get_use_case_scan_status", { scanId });
}
