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
  safeInvoke<DevProject[]>([], "dev_tools_list_projects", { status: status ?? null });

export const createProject = (name: string, rootPath: string, description?: string, techStack?: string) =>
  invoke<DevProject>("dev_tools_create_project", {
    name,
    rootPath,
    description: description ?? null,
    techStack: techStack ?? null,
  });

export const updateProject = (id: string, updates: { name?: string; description?: string; status?: string; techStack?: string }) =>
  invoke<DevProject>("dev_tools_update_project", {
    id,
    name: updates.name ?? null,
    description: updates.description ?? null,
    status: updates.status ?? null,
    techStack: updates.techStack ?? null,
  });

export const deleteProject = (id: string) =>
  invoke<boolean>("dev_tools_delete_project", { id });

export const scanDirectory = (path: string) =>
  invoke<DirectoryScanResult>("dev_tools_scan_directory", { path });

export const getActiveProject = () =>
  safeInvoke<DevProject | null>(null, "dev_tools_get_active_project");

export const setActiveProject = (id: string | null) =>
  safeInvoke<void>(undefined, "dev_tools_set_active_project", { id: id ?? null });

// ============================================================================
// Goals
// ============================================================================

export const listGoals = (projectId: string) =>
  safeInvoke<DevGoal[]>([], "dev_tools_list_goals", { projectId });

export const createGoal = (projectId: string, title: string, description?: string, contextId?: string, targetDate?: string) =>
  invoke<DevGoal>("dev_tools_create_goal", {
    projectId,
    title,
    description: description ?? null,
    contextId: contextId ?? null,
    targetDate: targetDate ?? null,
  });

export const updateGoal = (id: string, updates: { title?: string; description?: string; status?: string; progress?: number; targetDate?: string; contextId?: string }) =>
  invoke<DevGoal>("dev_tools_update_goal", {
    id,
    title: updates.title ?? null,
    description: updates.description ?? null,
    status: updates.status ?? null,
    progress: updates.progress ?? null,
    targetDate: updates.targetDate ?? null,
    contextId: updates.contextId ?? null,
  });

export const deleteGoal = (id: string) =>
  invoke<boolean>("dev_tools_delete_goal", { id });

export const reorderGoals = (projectId: string, goalIds: string[]) =>
  invoke<void>("dev_tools_reorder_goals", { projectId, goalIds });

export const recordGoalSignal = (goalId: string, signalType: string, delta?: number, message?: string, sourceId?: string) =>
  invoke<DevGoalSignal>("dev_tools_record_goal_signal", {
    goalId,
    signalType,
    delta: delta ?? null,
    message: message ?? null,
    sourceId: sourceId ?? null,
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
    icon: icon ?? null,
    groupType: groupType ?? null,
  });

export const updateContextGroup = (id: string, updates: { name?: string; color?: string; icon?: string; groupType?: string; healthScore?: number }) =>
  invoke<DevContextGroup>("dev_tools_update_context_group", {
    id,
    name: updates.name ?? null,
    color: updates.color ?? null,
    icon: updates.icon ?? null,
    groupType: updates.groupType ?? null,
    healthScore: updates.healthScore ?? null,
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
    groupId: groupId ?? null,
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
    groupId: groupId ?? null,
    description: description ?? null,
    entryPoints: entryPoints ?? null,
    dbTables: dbTables ?? null,
    keywords: keywords ?? null,
    apiSurface: apiSurface ?? null,
    crossRefs: crossRefs ?? null,
    techStack: techStack ?? null,
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
    name: updates.name ?? null,
    description: updates.description ?? null,
    filePaths: updates.filePaths ?? null,
    entryPoints: updates.entryPoints ?? null,
    dbTables: updates.dbTables ?? null,
    keywords: updates.keywords ?? null,
    apiSurface: updates.apiSurface ?? null,
    crossRefs: updates.crossRefs ?? null,
    techStack: updates.techStack ?? null,
    groupId: updates.groupId ?? null,
  });

export const deleteContext = (id: string) =>
  invoke<boolean>("dev_tools_delete_context", { id });

export const moveContext = (id: string, targetGroupId: string | null) =>
  invoke<DevContext>("dev_tools_move_context", { id, targetGroupId });

export const scanCodebase = (projectId: string, rootPath: string) =>
  invoke<DevContext[]>("dev_tools_scan_codebase", { projectId, rootPath }, undefined, 120_000);

export const generateContextDescription = (contextId: string) =>
  invoke<DevContext>("dev_tools_generate_context_description", { contextId }, undefined, 60_000);

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
    projectId: projectId ?? null,
    status: status ?? null,
    category: category ?? null,
    scanType: scanType ?? null,
    limit: limit ?? null,
    offset: offset ?? null,
  });

export const getIdea = (id: string) =>
  invoke<DevIdea>("dev_tools_get_idea", { id });

export const updateIdea = (id: string, updates: { status?: string; title?: string; description?: string; category?: string; effort?: number; impact?: number; risk?: number; rejectionReason?: string }) =>
  invoke<DevIdea>("dev_tools_update_idea", {
    id,
    status: updates.status ?? null,
    title: updates.title ?? null,
    description: updates.description ?? null,
    category: updates.category ?? null,
    effort: updates.effort ?? null,
    impact: updates.impact ?? null,
    risk: updates.risk ?? null,
    rejectionReason: updates.rejectionReason ?? null,
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
  invoke<DevScan>("dev_tools_run_scan", {
    projectId,
    scanTypes,
    contextId: contextId ?? null,
  }, undefined, 300_000);

export const getScan = (id: string) =>
  invoke<DevScan>("dev_tools_get_scan", { id });

export const listScans = (projectId?: string, limit?: number) =>
  safeInvoke<DevScan[]>([], "dev_tools_list_scans", {
    projectId: projectId ?? null,
    limit: limit ?? null,
  });

// ============================================================================
// Triage
// ============================================================================

const EMPTY_TRIAGE = { ideas: [] as DevIdea[], cursor: null, has_more: false, counts: { total: 0, pending: 0, accepted: 0, rejected: 0 } };

export const triageIdeas = (projectId: string, limit?: number, cursor?: string) =>
  safeInvoke<typeof EMPTY_TRIAGE>(EMPTY_TRIAGE, "dev_tools_triage_ideas", {
    projectId,
    limit: limit ?? null,
    cursor: cursor ?? null,
  });

export const acceptIdea = (id: string) =>
  invoke<DevIdea>("dev_tools_accept_idea", { id });

export const rejectIdea = (id: string, reason?: string) =>
  invoke<DevIdea>("dev_tools_reject_idea", { id, reason: reason ?? null });

export const deleteTriageIdea = (id: string) =>
  invoke<boolean>("dev_tools_delete_triage_idea", { id });

// ============================================================================
// Triage Rules
// ============================================================================

export const listTriageRules = (projectId?: string) =>
  safeInvoke<TriageRule[]>([], "dev_tools_list_triage_rules", { projectId: projectId ?? null });

export const createTriageRule = (name: string, conditions: string, action: string, projectId?: string) =>
  invoke<TriageRule>("dev_tools_create_triage_rule", {
    name,
    conditions,
    action,
    projectId: projectId ?? null,
  });

export const updateTriageRule = (id: string, updates: { name?: string; conditions?: string; action?: string; enabled?: boolean }) =>
  invoke<TriageRule>("dev_tools_update_triage_rule", {
    id,
    name: updates.name ?? null,
    conditions: updates.conditions ?? null,
    action: updates.action ?? null,
    enabled: updates.enabled ?? null,
  });

export const deleteTriageRule = (id: string) =>
  invoke<boolean>("dev_tools_delete_triage_rule", { id });

export const runTriageRules = (projectId: string) =>
  invoke<{ applied: number; ideas_affected: number }>("dev_tools_run_triage_rules", { projectId });

// ============================================================================
// Tasks
// ============================================================================

export const listTasks = (projectId?: string, status?: string, goalId?: string) =>
  safeInvoke<DevTask[]>([], "dev_tools_list_tasks", {
    projectId: projectId ?? null,
    status: status ?? null,
    goalId: goalId ?? null,
  });

export const createTask = (title: string, projectId?: string, description?: string, sourceIdeaId?: string, goalId?: string) =>
  invoke<DevTask>("dev_tools_create_task", {
    title,
    projectId: projectId ?? null,
    description: description ?? null,
    sourceIdeaId: sourceIdeaId ?? null,
    goalId: goalId ?? null,
  });

export const batchCreateTasks = (tasks: { title: string; description?: string; sourceIdeaId?: string; goalId?: string }[], projectId?: string) =>
  invoke<DevTask[]>("dev_tools_batch_create_tasks", {
    tasks: tasks.map((t) => ({
      title: t.title,
      description: t.description ?? null,
      sourceIdeaId: t.sourceIdeaId ?? null,
      goalId: t.goalId ?? null,
    })),
    projectId: projectId ?? null,
  });

export const startTask = (id: string) =>
  invoke<DevTask>("dev_tools_start_task", { id });

export const cancelTask = (id: string) =>
  invoke<DevTask>("dev_tools_cancel_task", { id });

export const startBatch = (taskIds: string[]) =>
  invoke<{ batch_id: string; started: number }>("dev_tools_start_batch", { taskIds });

export const getBatchStatus = (batchId: string) =>
  invoke<{ batch_id: string; total: number; completed: number; failed: number; running: number; pending: number; tasks: DevTask[] }>(
    "dev_tools_get_batch_status",
    { batchId },
  );
