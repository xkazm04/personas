import { invoke } from "@tauri-apps/api/core";

// ============================================================================
// Design Analysis
// ============================================================================

export interface DesignStartResult {
  design_id: string;
}

export interface FeasibilityResult {
  confirmed_capabilities: string[];
  issues: string[];
  overall: string;
}

export const startDesignAnalysis = (instruction: string, personaId: string, designId?: string) =>
  invoke<DesignStartResult>("start_design_analysis", { instruction, personaId, designId: designId ?? null });

export const refineDesign = (personaId: string, feedback: string, currentResult?: string | null, designId?: string) =>
  invoke<DesignStartResult>("refine_design", { personaId, feedback, currentResult: currentResult ?? null, designId: designId ?? null });

export const testDesignFeasibility = (designResult: string) =>
  invoke<FeasibilityResult>("test_design_feasibility", { designResult });

export const cancelDesignAnalysis = () =>
  invoke<void>("cancel_design_analysis");
