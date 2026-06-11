// KPI layer API (docs/plans/kpi-driven-orchestration.md) — wrappers over the
// dev_tools_*_kpi* Tauri commands. KPIs are the outcome layer above goals:
// definitions with a stored measurement procedure + a time series; the
// proposal scan fills the review queue (status='proposed') that the sub_kpis
// UI drains via accept / adjust / reject.
import { invokeWithTimeout as invoke } from "@/lib/tauriInvoke";

import type { DevKpi } from "@/lib/bindings/DevKpi";
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
}

export async function createKpi(input: CreateKpiInput): Promise<DevKpi> {
  return invoke<DevKpi>("dev_tools_create_kpi", { ...input });
}

/** Field-wise update. `null` clears a nullable column; `undefined` leaves it unchanged. */
export interface UpdateKpiInput {
  name?: string;
  description?: string | null;
  contextGroupId?: string | null;
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
}

export async function updateKpi(id: string, updates: UpdateKpiInput): Promise<DevKpi> {
  return invoke<DevKpi>("dev_tools_update_kpi", { id, ...updates });
}

export async function deleteKpi(id: string): Promise<boolean> {
  return invoke<boolean>("dev_tools_delete_kpi", { id });
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
