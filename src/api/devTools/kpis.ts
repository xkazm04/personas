// KPI layer API (docs/plans/kpi-driven-orchestration.md) — wrappers over the
// dev_tools_*_kpi* Tauri commands. KPIs are the outcome layer above goals:
// definitions with a stored measurement procedure + a time series; the
// proposal scan fills the review queue (status='proposed') that the sub_kpis
// UI drains via accept / adjust / reject.
import { invokeWithTimeout as invoke } from "@/lib/tauriInvoke";

import type { DevKpi } from "@/lib/bindings/DevKpi";
import type { DevKpiBinding } from "@/lib/bindings/DevKpiBinding";
import type { DevKpiMeasurement } from "@/lib/bindings/DevKpiMeasurement";

export async function listKpis(projectId: string, status?: string): Promise<DevKpi[]> {
  return invoke<DevKpi[]>("dev_tools_list_kpis", { projectId, status });
}

export async function getKpi(id: string): Promise<DevKpi> {
  return invoke<DevKpi>("dev_tools_get_kpi", { id });
}

export interface CreateKpiInput {
  projectId: string;
  name: string;
  description?: string;
  contextGroupId?: string;
  contextId?: string;
  category: string;
  measureKind: string;
  measureConfig?: string;
  unit?: string;
  direction?: string;
  baselineValue?: number;
  targetValue?: number;
  targetDate?: string;
  cadence?: string;
  status?: string;
  rationale?: string;
  neededConnector?: string;
  metricType?: string;
}

export async function createKpi(input: CreateKpiInput): Promise<DevKpi> {
  return invoke<DevKpi>("dev_tools_create_kpi", { ...input });
}

/** Field-wise update. `null` clears a nullable column; `undefined` leaves it unchanged. */
export interface UpdateKpiInput {
  name?: string;
  description?: string | null;
  contextGroupId?: string | null;
  contextId?: string | null;
  category?: string;
  measureKind?: string;
  measureConfig?: string;
  unit?: string;
  direction?: string;
  baselineValue?: number | null;
  targetValue?: number | null;
  targetDate?: string | null;
  cadence?: string;
  status?: string;
  neededConnector?: string | null;
  metricType?: string | null;
  tier?: string;
}

export async function updateKpi(id: string, updates: UpdateKpiInput): Promise<DevKpi> {
  return invoke<DevKpi>("dev_tools_update_kpi", { id, ...updates });
}

export async function deleteKpi(id: string): Promise<boolean> {
  return invoke<boolean>("dev_tools_delete_kpi", { id });
}

/** Persist the Factory console's calibration + assessment. Omitted fields are preserved. */
export interface KpiAssessmentInput {
  warnAt?: number;
  critAt?: number;
  manualRating?: number;
  pros?: string;
  cons?: string;
}
export async function saveKpiAssessment(id: string, a: KpiAssessmentInput): Promise<DevKpi> {
  return invoke<DevKpi>("dev_tools_save_kpi_assessment", {
    id,
    warnAt: a.warnAt,
    critAt: a.critAt,
    manualRating: a.manualRating,
    pros: a.pros,
    cons: a.cons,
  });
}

export async function listKpiMeasurements(
  kpiId: string,
  limit?: number,
): Promise<DevKpiMeasurement[]> {
  return invoke<DevKpiMeasurement[]>("dev_tools_list_kpi_measurements", { kpiId, limit });
}

export async function recordKpiMeasurement(
  kpiId: string,
  value: number,
  source?: string,
  evidence?: string,
  note?: string,
): Promise<DevKpiMeasurement> {
  return invoke<DevKpiMeasurement>("dev_tools_record_kpi_measurement", {
    kpiId,
    value,
    source,
    evidence,
    note,
  });
}

/** Start a KPI proposal scan; progress streams via KPI_SCAN_* events. */
export async function scanKpis(projectId: string): Promise<{ scan_id: string }> {
  return invoke<{ scan_id: string }>("dev_tools_scan_kpis", { projectId }, { timeoutMs: 30_000 });
}

export async function cancelKpiScan(scanId: string): Promise<boolean> {
  return invoke<boolean>("dev_tools_cancel_kpi_scan", { scanId });
}

export async function getKpiScanStatus(scanId: string): Promise<{
  scan_id: string;
  status: string;
  error?: string | null;
  lines?: string[];
}> {
  return invoke("dev_tools_get_kpi_scan_status", { scanId });
}

// =============================================================================
// Measurement composition (Factory "measurement setup") — headless Claude in the
// project root composes + TESTS a codebase measurement, or proposes a whole KPI
// from a one-line intent. Both are background tasks polled for their result.
// =============================================================================

/** A tested codebase measurement composed by the AI agent. */
export interface KpiMeasureComposed {
  cmd: string;
  parse: string;
  value: number;
  evidence?: string;
}

/** A full KPI proposed by the AI agent from a one-line intent. */
export interface KpiProposed {
  name: string;
  description?: string;
  category: string;
  tier?: string;
  measure_kind: string;
  measure_config?: unknown;
  unit?: string;
  direction?: string;
  baseline_hint?: number | null;
  suggested_target?: number | null;
  cadence?: string;
  rationale?: string;
  needed_connector?: string;
  metric_type?: string;
}

export interface KpiComposeStatus {
  task_id: string;
  status: string; // running | completed | failed | cancelled | not_found
  error?: string | null;
  lines?: string[];
  /** Present once completed: the composed envelope. `kpi_measure: null` means
   * "not measurable from the codebase". `result` itself is null until then. */
  result?: { kpi_measure?: KpiMeasureComposed | null; kpi_proposal?: KpiProposed | null } | null;
}

/** Start composing + testing a codebase measurement for one existing KPI. */
export async function composeKpiMeasure(kpiId: string): Promise<{ task_id: string }> {
  return invoke<{ task_id: string }>("dev_tools_compose_kpi_measure", { kpiId }, { timeoutMs: 30_000 });
}

export interface ProposeKpiInput {
  contextGroupId?: string;
  contextId?: string;
  intent: string;
}

/** Start proposing a complete KPI (metadata + tested measurement) from intent. */
export async function proposeKpi(
  projectId: string,
  input: ProposeKpiInput,
): Promise<{ task_id: string }> {
  return invoke<{ task_id: string }>(
    "dev_tools_propose_kpi",
    {
      projectId,
      contextGroupId: input.contextGroupId,
      contextId: input.contextId,
      intent: input.intent,
    },
    { timeoutMs: 30_000 },
  );
}

export interface ProposeKpiAutoInput {
  contextGroupId?: string;
  contextId?: string;
  name: string;
  description?: string;
  category: string;
  tier: string;
  direction: string;
  measureKind: string;
  cadence: string;
  unit?: string;
  neededConnector?: string;
  derivedMetric?: string;
}

/** Create a PROPOSED KPI from structured metadata; for the codebase mechanism a
 * truly-background compose then applies the tested measurement + baseline. The
 * KPI is returned immediately (the modal closes; the proposal fills in on its
 * own and lands in the Teams › KPIs review queue). */
export async function proposeKpiAuto(projectId: string, input: ProposeKpiAutoInput): Promise<DevKpi> {
  return invoke<DevKpi>("dev_tools_propose_kpi_auto", { projectId, ...input }, { timeoutMs: 30_000 });
}

export async function getKpiComposeStatus(taskId: string): Promise<KpiComposeStatus> {
  return invoke<KpiComposeStatus>("dev_tools_get_kpi_compose_status", { taskId });
}

export async function cancelKpiCompose(taskId: string): Promise<boolean> {
  return invoke<boolean>("dev_tools_cancel_kpi_compose", { taskId });
}

/** Measure one KPI now (codebase/derived). Coverage runs take minutes. */
export async function evaluateKpi(kpiId: string): Promise<DevKpiMeasurement> {
  return invoke<DevKpiMeasurement>("dev_tools_evaluate_kpi", { kpiId }, { timeoutMs: 360_000 });
}

/** Measure every due active KPI of a project. Returns name → value | "error: ...". */
export async function evaluateDueKpis(
  projectId: string,
): Promise<Record<string, number | string>> {
  return invoke("dev_tools_evaluate_due_kpis", { projectId }, { timeoutMs: 900_000 });
}

/** All KPIs across every project (cross-project dashboard scope). */
export async function listAllKpis(): Promise<DevKpi[]> {
  return invoke<DevKpi[]>("dev_tools_list_all_kpis", {});
}

/** Bulk measurement history for trend charts (chronological, bounded per KPI). */
export async function listKpiMeasurementsBulk(
  kpiIds: string[],
  perKpi?: number,
): Promise<DevKpiMeasurement[]> {
  return invoke<DevKpiMeasurement[]>("dev_tools_list_kpi_measurements_bulk", { kpiIds, perKpi });
}

// =============================================================================
// P6 — type-bound connector bindings (compose → verify → freeze → replay)
// =============================================================================

/** A metric-type contract (mirrors engine/kpi_binding.rs METRIC_TYPES). */
export interface KpiMetricType {
  id: string;
  label: string;
  unit: string;
  direction: string;
  categories: string[];
  contract: string;
  min: number;
  integer: boolean;
}

export async function listKpiMetricTypes(): Promise<KpiMetricType[]> {
  return invoke<KpiMetricType[]>("dev_tools_list_kpi_metric_types", {});
}

/** Vault credential able to answer a metric type (category-matched). */
export interface KpiMatchingCredential {
  credential_id: string;
  name: string;
  service_type: string;
  connector_label: string;
  category: string;
  has_recipe: boolean;
}

export async function kpiMatchingCredentials(
  metricType: string,
): Promise<KpiMatchingCredential[]> {
  return invoke<KpiMatchingCredential[]>("dev_tools_kpi_matching_credentials", { metricType });
}

/** The frozen retrieval procedure — one HTTP call + one extraction. */
export interface KpiProcedure {
  http: { method: string; url: string; headers?: Record<string, string>; body?: unknown };
  extract: string;
  plan?: string;
}

export interface KpiComposeResult {
  procedure: KpiProcedure;
  composed_by: string;
  value: number;
  evidence: string | null;
}

/** Compose + live-verify a candidate binding. Persists nothing; the LLM path
 * can take minutes (compose + live HTTP test). */
export async function composeKpiBinding(
  kpiId: string,
  credentialId: string,
): Promise<KpiComposeResult> {
  return invoke<KpiComposeResult>(
    "dev_tools_kpi_compose_binding",
    { kpiId, credentialId },
    { timeoutMs: 360_000 },
  );
}

/** Freeze a verified procedure as the KPI's active binding. */
export async function activateKpiBinding(
  kpiId: string,
  credentialId: string,
  procedure: KpiProcedure,
  composedBy: string,
  verifiedValue: number,
  evidence?: string | null,
): Promise<DevKpiBinding> {
  return invoke<DevKpiBinding>("dev_tools_kpi_activate_binding", {
    kpiId,
    credentialId,
    procedure: JSON.stringify(procedure),
    composedBy,
    verifiedValue,
    evidence: evidence ?? undefined,
  });
}

export async function listKpiBindings(kpiId: string): Promise<DevKpiBinding[]> {
  return invoke<DevKpiBinding[]>("dev_tools_kpi_list_bindings", { kpiId });
}
