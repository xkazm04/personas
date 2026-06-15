// Per-project autopilot — the cockpit's single autonomy switch over a project's
// KPI → goal → team loop (docs/plans/kpi-driven-orchestration.md, direction D2).
// Wraps the dev_tools_*_autopilot_mode commands; the engine-side mode→capability
// semantics live in src-tauri/src/engine/autopilot.rs.
import { invokeWithTimeout as invoke } from "@/lib/tauriInvoke";

/** The four explicit modes. `null` (unset) means the project follows the legacy
 *  global autonomy flags; the UI renders that as `off`. */
export type AutopilotMode = "off" | "measure" | "suggest" | "full";

export async function getAutopilotMode(projectId: string): Promise<AutopilotMode | null> {
  const v = await invoke<string | null>("dev_tools_get_autopilot_mode", { projectId });
  return (v as AutopilotMode | null) ?? null;
}

/** Set a project's mode. Pass an empty string to clear the override (revert to
 *  following the global flags). Returns the stored mode, or null when cleared. */
export async function setAutopilotMode(
  projectId: string,
  mode: AutopilotMode | "",
): Promise<AutopilotMode | null> {
  const v = await invoke<string | null>("dev_tools_set_autopilot_mode", { projectId, mode });
  return (v as AutopilotMode | null) ?? null;
}
