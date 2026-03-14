import { invokeWithTimeout as invoke } from "@/lib/tauriInvoke";

import type { DevProject } from "@/lib/bindings/DevProject";
import type { DirectoryScanResult } from "@/lib/bindings/DirectoryScanResult";
import type { DevGoal } from "@/lib/bindings/DevGoal";
import type { DevGoalSignal } from "@/lib/bindings/DevGoalSignal";
import type { DevContextGroup } from "@/lib/bindings/DevContextGroup";
import type { DevContext } from "@/lib/bindings/DevContext";
import type { DevContextGroupRelationship } from "@/lib/bindings/DevContextGroupRelationship";
import type { DevIdea } from "@/lib/bindings/DevIdea";
import type { DevScan } from "@/lib/bindings/DevScan";
import type { DevTask } from "@/lib/bindings/DevTask";
import type { ScanAgentMeta } from "@/lib/bindings/ScanAgentMeta";
import type { TriageRule } from "@/lib/bindings/TriageRule";

// ---------------------------------------------------------------------------
// Safe invoke: returns fallback when backend commands are not yet compiled.
// ---------------------------------------------------------------------------

function isCommandNotFound(err: unknown): boolean {
  const msg = typeof err === "string" ? err : err instanceof Error ? err.message : String(err);
  return msg.includes("not found") || msg.includes("Command") && msg.includes("not found");
}

/** Invoke that silently returns `fallback` when the Tauri command doesn't exist. */
async function safeInvoke<T>(fallback: T, ...args: Parameters<typeof invoke<T>>): Promise<T> {
  try {
    return await invoke<T>(...args);
  } catch (err) {
    if (isCommandNotFound(err)) return fallback;
    throw err;
  }
}

// Re-export binding types for convenience
export type { DevProject } from "@/lib/bindings/DevProject";
export type { DirectoryScanResult } from "@/lib/bindings/DirectoryScanResult";
export type { DevGoal } from "@/lib/bindings/DevGoal";
export type { DevGoalSignal } from "@/lib/bindings/DevGoalSignal";
export type { DevContextGroup } from "@/lib/bindings/DevContextGroup";
export type { DevContext } from "@/lib/bindings/DevContext";
export type { DevContextGroupRelationship } from "@/lib/bindings/DevContextGroupRelationship";
export type { DevIdea } from "@/lib/bindings/DevIdea";
export type { DevScan } from "@/lib/bindings/DevScan";
export type { DevTask } from "@/lib/bindings/DevTask";
export type { ScanAgentMeta } from "@/lib/bindings/ScanAgentMeta";
export type { TriageRule } from "@/lib/bindings/TriageRule";

// ============================================================================
// Projects
// ============================================================================

export const listProjects = (status?: string) =>
  safeInvoke<DevProject[]>([], "dev_tools_list_projects", { status: status });

export const createProject = (name: string, rootPath: string, description?: string, techStack?: string) =>
  invoke<DevProject>("dev_tools_create_project", {
    name,
    rootPath,
    description: description,
    techStack: techStack,
  });

export const updateProject = (id: string, updates: { name?: string; description?: string; status?: string; techStack?: string }) =>
  invoke<DevProject>("dev_tools_update_project", {
    id,
    name: updates.name,
    description: updates.description,
    status: updates.status,
    techStack: updates.techStack,
  });

export const deleteProject = (id: string) =>
  invoke<boolean>("dev_tools_delete_project", { id });

export const scanDirectory = (path: string) =>
  safeInvoke<DirectoryScanResult>({} as DirectoryScanResult, "dev_tools_scan_directory", { path });

export const getActiveProject = () =>
  safeInvoke<DevProject | null>(null, "dev_tools_get_active_project");

export const setActiveProject = (id: string | null) =>
  safeInvoke<void>(undefined, "dev_tools_set_active_project", { id: id });

// ============================================================================
// Goals
// ============================================================================

export const listGoals = (projectId: string) =>
  safeInvoke<DevGoal[]>([], "dev_tools_list_goals", { projectId });

export const createGoal = (projectId: string, title: string, description?: string, contextId?: string, targetDate?: string) =>
  invoke<DevGoal>("dev_tools_create_goal", {
    projectId,
    title,
    description: description,
    contextId: contextId,
    targetDate: targetDate,
  });

export const updateGoal = (id: string, updates: { title?: string; description?: string; status?: string; progress?: number; targetDate?: string; contextId?: string }) =>
  invoke<DevGoal>("dev_tools_update_goal", {
    id,
    title: updates.title,
    description: updates.description,
    status: updates.status,
    progress: updates.progress,
    targetDate: updates.targetDate,
    contextId: updates.contextId,
  });

export const deleteGoal = (id: string) =>
  invoke<boolean>("dev_tools_delete_goal", { id });

export const reorderGoals = (projectId: string, goalIds: string[]) =>
  invoke<void>("dev_tools_reorder_goals", { projectId, goalIds });

export const recordGoalSignal = (goalId: string, signalType: string, delta?: number, message?: string, sourceId?: string) =>
  safeInvoke<DevGoalSignal>({} as DevGoalSignal, "dev_tools_record_goal_signal", {
    goalId,
    signalType,
    delta: delta,
    message: message,
    sourceId: sourceId,
  });

export const listGoalSignals = (goalId: string) =>
  safeInvoke<DevGoalSignal[]>([], "dev_tools_list_goal_signals", { goalId });

// ============================================================================
// Context Groups
// ============================================================================

export const listContextGroups = (projectId: string) =>
  safeInvoke<DevContextGroup[]>([], "dev_tools_list_context_groups", { projectId });

export const createContextGroup = (projectId: string, name: string, color: string, icon?: string, groupType?: string) =>
  invoke<DevContextGroup>("dev_tools_create_context_group", {
    projectId,
    name,
    color,
    icon: icon,
    groupType: groupType,
  });

export const updateContextGroup = (id: string, updates: { name?: string; color?: string; icon?: string; groupType?: string; healthScore?: number }) =>
  invoke<DevContextGroup>("dev_tools_update_context_group", {
    id,
    name: updates.name,
    color: updates.color,
    icon: updates.icon,
    groupType: updates.groupType,
    healthScore: updates.healthScore,
  });

export const deleteContextGroup = (id: string) =>
  invoke<boolean>("dev_tools_delete_context_group", { id });

export const reorderContextGroups = (projectId: string, groupIds: string[]) =>
  invoke<void>("dev_tools_reorder_context_groups", { projectId, groupIds });

// ============================================================================
// Contexts
// ============================================================================

export const listContexts = (projectId: string, groupId?: string) =>
  safeInvoke<DevContext[]>([], "dev_tools_list_contexts", {
    projectId,
    groupId: groupId,
  });

export const createContext = (
  projectId: string,
  name: string,
  filePaths: string,
  groupId?: string,
  description?: string,
  entryPoints?: string,
  dbTables?: string,
  keywords?: string,
  apiSurface?: string,
  crossRefs?: string,
  techStack?: string,
) =>
  invoke<DevContext>("dev_tools_create_context", {
    projectId,
    name,
    filePaths,
    groupId: groupId,
    description: description,
    entryPoints: entryPoints,
    dbTables: dbTables,
    keywords: keywords,
    apiSurface: apiSurface,
    crossRefs: crossRefs,
    techStack: techStack,
  });

export const updateContext = (id: string, updates: {
  name?: string;
  description?: string;
  filePaths?: string;
  entryPoints?: string;
  dbTables?: string;
  keywords?: string;
  apiSurface?: string;
  crossRefs?: string;
  techStack?: string;
  groupId?: string;
}) =>
  invoke<DevContext>("dev_tools_update_context", {
    id,
    name: updates.name,
    description: updates.description,
    filePaths: updates.filePaths,
    entryPoints: updates.entryPoints,
    dbTables: updates.dbTables,
    keywords: updates.keywords,
    apiSurface: updates.apiSurface,
    crossRefs: updates.crossRefs,
    techStack: updates.techStack,
    groupId: updates.groupId,
  });

export const deleteContext = (id: string) =>
  invoke<boolean>("dev_tools_delete_context", { id });

export const moveContext = (id: string, targetGroupId: string | null) =>
  safeInvoke<DevContext>({} as DevContext, "dev_tools_move_context", { id, targetGroupId });

export const scanCodebase = (projectId: string, rootPath: string) =>
  safeInvoke<DevContext[]>([], "dev_tools_scan_codebase", { projectId, rootPath }, undefined, 120_000);

export const generateContextDescription = (contextId: string) =>
  safeInvoke<DevContext>({} as DevContext, "dev_tools_generate_context_description", { contextId }, undefined, 60_000);

// ============================================================================
// Context Group Relationships
// ============================================================================

export const listContextGroupRelationships = (projectId: string) =>
  safeInvoke<DevContextGroupRelationship[]>([], "dev_tools_list_context_group_relationships", { projectId });

export const createContextGroupRelationship = (projectId: string, sourceGroupId: string, targetGroupId: string) =>
  invoke<DevContextGroupRelationship>("dev_tools_create_context_group_relationship", {
    projectId,
    sourceGroupId,
    targetGroupId,
  });

export const deleteContextGroupRelationship = (id: string) =>
  invoke<boolean>("dev_tools_delete_context_group_relationship", { id });

// ============================================================================
// Ideas
// ============================================================================

export const listIdeas = (projectId?: string, status?: string, category?: string, scanType?: string, limit?: number, offset?: number) =>
  safeInvoke<DevIdea[]>([], "dev_tools_list_ideas", {
    projectId: projectId,
    status: status,
    category: category,
    scanType: scanType,
    limit: limit,
    offset: offset,
  });

export const getIdea = (id: string) =>
  invoke<DevIdea>("dev_tools_get_idea", { id });

export const updateIdea = (id: string, updates: { status?: string; title?: string; description?: string; category?: string; effort?: number; impact?: number; risk?: number; rejectionReason?: string }) =>
  invoke<DevIdea>("dev_tools_update_idea", {
    id,
    status: updates.status,
    title: updates.title,
    description: updates.description,
    category: updates.category,
    effort: updates.effort,
    impact: updates.impact,
    risk: updates.risk,
    rejectionReason: updates.rejectionReason,
  });

export const deleteIdea = (id: string) =>
  invoke<boolean>("dev_tools_delete_idea", { id });

export const bulkDeleteIdeas = (ids: string[]) =>
  invoke<number>("dev_tools_bulk_delete_ideas", { ids });

// ============================================================================
// Scans
// ============================================================================

export const listScanAgents = () =>
  safeInvoke<ScanAgentMeta[]>([], "dev_tools_list_scan_agents");

export const runScan = (projectId: string, scanTypes: string[], contextId?: string) =>
  safeInvoke<DevScan>({} as DevScan, "dev_tools_run_scan", {
    projectId,
    scanTypes,
    contextId: contextId,
  }, undefined, 300_000);

export const getScan = (id: string) =>
  safeInvoke<DevScan>({} as DevScan, "dev_tools_get_scan", { id });

export const listScans = (projectId?: string, limit?: number) =>
  safeInvoke<DevScan[]>([], "dev_tools_list_scans", {
    projectId: projectId,
    limit: limit,
  });

// ============================================================================
// Triage
// ============================================================================

const EMPTY_TRIAGE = { ideas: [] as DevIdea[], cursor: null, has_more: false, counts: { total: 0, pending: 0, accepted: 0, rejected: 0 } };

export const triageIdeas = (projectId: string, limit?: number, cursor?: string) =>
  safeInvoke<typeof EMPTY_TRIAGE>(EMPTY_TRIAGE, "dev_tools_triage_ideas", {
    projectId,
    limit: limit,
    cursor: cursor,
  });

export const acceptIdea = (id: string) =>
  safeInvoke<DevIdea>({} as DevIdea, "dev_tools_accept_idea", { id });

export const rejectIdea = (id: string, reason?: string) =>
  safeInvoke<DevIdea>({} as DevIdea, "dev_tools_reject_idea", { id, reason: reason });

export const deleteTriageIdea = (id: string) =>
  safeInvoke<boolean>(false, "dev_tools_delete_triage_idea", { id });

// ============================================================================
// Triage Rules
// ============================================================================

export const listTriageRules = (projectId?: string) =>
  safeInvoke<TriageRule[]>([], "dev_tools_list_triage_rules", { projectId: projectId });

export const createTriageRule = (name: string, conditions: string, action: string, projectId?: string) =>
  invoke<TriageRule>("dev_tools_create_triage_rule", {
    name,
    conditions,
    action,
    projectId: projectId,
  });

export const updateTriageRule = (id: string, updates: { name?: string; conditions?: string; action?: string; enabled?: boolean }) =>
  invoke<TriageRule>("dev_tools_update_triage_rule", {
    id,
    name: updates.name,
    conditions: updates.conditions,
    action: updates.action,
    enabled: updates.enabled,
  });

export const deleteTriageRule = (id: string) =>
  invoke<boolean>("dev_tools_delete_triage_rule", { id });

export const runTriageRules = (projectId: string) =>
  safeInvoke<{ applied: number; ideas_affected: number }>({ applied: 0, ideas_affected: 0 }, "dev_tools_run_triage_rules", { projectId });

// ============================================================================
// Tasks
// ============================================================================

export const listTasks = (projectId?: string, status?: string, goalId?: string) =>
  safeInvoke<DevTask[]>([], "dev_tools_list_tasks", {
    projectId: projectId,
    status: status,
    goalId: goalId,
  });

export const createTask = (title: string, projectId?: string, description?: string, sourceIdeaId?: string, goalId?: string) =>
  invoke<DevTask>("dev_tools_create_task", {
    title,
    projectId: projectId,
    description: description,
    sourceIdeaId: sourceIdeaId,
    goalId: goalId,
  });

export const batchCreateTasks = (tasks: { title: string; description?: string; sourceIdeaId?: string; goalId?: string }[], projectId?: string) =>
  safeInvoke<DevTask[]>([], "dev_tools_batch_create_tasks", {
    tasks: tasks.map((t) => ({
      title: t.title,
      description: t.description,
      sourceIdeaId: t.sourceIdeaId,
      goalId: t.goalId,
    })),
    projectId: projectId,
  });

export const startTask = (id: string) =>
  safeInvoke<DevTask>({} as DevTask, "dev_tools_start_task", { id });

export const cancelTask = (id: string) =>
  safeInvoke<DevTask>({} as DevTask, "dev_tools_cancel_task", { id });

export const startBatch = (taskIds: string[]) =>
  safeInvoke<{ batch_id: string; started: number }>({ batch_id: "", started: 0 }, "dev_tools_start_batch", { taskIds });

export const getBatchStatus = (batchId: string) =>
  safeInvoke<{ batch_id: string; total: number; completed: number; failed: number; running: number; pending: number; tasks: DevTask[] }>(
    { batch_id: "", total: 0, completed: 0, failed: 0, running: 0, pending: 0, tasks: [] },
    "dev_tools_get_batch_status",
    { batchId },
  );
