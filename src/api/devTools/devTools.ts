import { invokeWithTimeout as invoke } from "@/lib/tauriInvoke";

import type { DevProject } from "@/lib/bindings/DevProject";
import type { DirectoryScanResult } from "@/lib/bindings/DirectoryScanResult";
import type { DevGoal } from "@/lib/bindings/DevGoal";
import type { DevGoalSignal } from "@/lib/bindings/DevGoalSignal";
import type { DevGoalDependency } from "@/lib/bindings/DevGoalDependency";
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
  // Prefer structured kind from Tauri errors
  if (typeof err === 'object' && err !== null && 'kind' in err) {
    return (err as { kind: string }).kind === 'not_found';
  }
  const msg = typeof err === "string" ? err : err instanceof Error ? err.message
    : typeof err === "object" && err !== null && "error" in err ? String((err as { error: string }).error)
    : String(err);
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

export const createProject = (name: string, rootPath: string, description?: string, techStack?: string, githubUrl?: string) =>
  invoke<DevProject>("dev_tools_create_project", {
    name,
    rootPath,
    description: description,
    techStack: techStack,
    githubUrl: githubUrl,
  });

export const updateProject = (id: string, updates: { name?: string; description?: string; status?: string; techStack?: string; githubUrl?: string }) =>
  invoke<DevProject>("dev_tools_update_project", {
    id,
    name: updates.name,
    description: updates.description,
    status: updates.status,
    techStack: updates.techStack,
    githubUrl: updates.githubUrl,
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

export const createGoal = (projectId: string, title: string, description?: string, contextId?: string, targetDate?: string, parentGoalId?: string) =>
  invoke<DevGoal>("dev_tools_create_goal", {
    projectId,
    title,
    description: description,
    contextId: contextId,
    targetDate: targetDate,
    parentGoalId: parentGoalId,
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
// Goal Dependencies
// ============================================================================

export const listGoalDependencies = (goalId: string) =>
  safeInvoke<DevGoalDependency[]>([], "dev_tools_list_goal_dependencies", { goalId });

export const addGoalDependency = (goalId: string, dependsOnId: string, dependencyType?: string) =>
  invoke<DevGoalDependency>("dev_tools_add_goal_dependency", {
    goalId,
    dependsOnId,
    dependencyType: dependencyType,
  });

export const removeGoalDependency = (id: string) =>
  invoke<boolean>("dev_tools_remove_goal_dependency", { id });

// ============================================================================
// Cross-Project Metadata Map
// ============================================================================

export interface CrossProjectCapability {
  name: string;
  color: string;
  group_type: string | null;
  context_count: number;
}

export interface CrossProjectProjectMetadata {
  project_id: string;
  name: string;
  root_path: string;
  description: string | null;
  github_url: string | null;
  status: string;
  declared_tech_stack: string | null;
  summary: string;
  capabilities: CrossProjectCapability[];
  keywords: string[];
  tech_layers: string[];
  entry_points: string[];
  db_tables: string[];
  api_surface: string[];
  cross_refs: string[];
  hot_directories: string[];
  context_count: number;
  group_count: number;
  active_goal_count: number;
}

export interface CrossProjectMetadataMap {
  projects: CrossProjectProjectMetadata[];
  cross_project: {
    shared_keywords: { keyword: string; projects: string[]; count: number }[];
    similarity_matrix: { source: string; target: string; similarity: number }[];
    tech_distribution: { layer: string; project_count: number }[];
    relations: { source: string; target: string; type: string; details: string | null }[];
  };
  generated_at: string;
  total_projects: number;
}

export const generateCrossProjectMetadata = () =>
  invoke<CrossProjectMetadataMap>("dev_tools_generate_cross_project_metadata");

export const getCrossProjectMetadata = () =>
  safeInvoke<CrossProjectMetadataMap | null>(null, "dev_tools_get_cross_project_metadata");

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
  invoke<{ scan_id: string }>("dev_tools_scan_codebase", { projectId, rootPath });

export const cancelScanCodebase = (scanId: string) =>
  safeInvoke<boolean>(false, "dev_tools_cancel_scan_codebase", { scanId });

export const getScanCodebaseStatus = (scanId: string) =>
  safeInvoke<{ scan_id: string; status: string; error: string | null; lines: string[] }>(
    { scan_id: scanId, status: "not_found", error: null, lines: [] },
    "dev_tools_get_scan_codebase_status",
    { scanId },
  );

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
  invoke<{ scan_id: string; scan_type: string }>("dev_tools_run_scan", {
    projectId,
    scanTypes,
    contextId: contextId,
  });

export const cancelScan = (scanId: string) =>
  safeInvoke<boolean>(false, "dev_tools_cancel_scan", { scanId });

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

// -- Task Execution (CLI-powered) -------------------------------------------

export const executeTask = (taskId: string) =>
  invoke<{ task_id: string }>("dev_tools_execute_task", { taskId });

export const startBatchExecution = (taskIds: string[], maxParallel?: number) =>
  invoke<{ batch_id: string; started: number }>("dev_tools_start_batch", { taskIds, maxParallel });

export const cancelTaskExecution = (taskId: string) =>
  safeInvoke<boolean>(false, "dev_tools_cancel_task_execution", { taskId });

// ============================================================================
// Cross-Project (Codebases connector)
// ============================================================================

export const getCrossProjectMap = () =>
  safeInvoke<{ projects: unknown[]; relations: unknown[]; generated_at: string }>(
    { projects: [], relations: [], generated_at: '' },
    "dev_tools_get_cross_project_map",
  );

export const upsertCrossProjectRelation = (
  sourceProjectId: string,
  targetProjectId: string,
  relationType: string,
  details?: string,
) =>
  invoke("dev_tools_upsert_cross_project_relation", {
    sourceProjectId,
    targetProjectId,
    relationType,
    details,
  });

export const listCrossProjectRelations = () =>
  safeInvoke<unknown[]>([], "dev_tools_list_cross_project_relations");

export const createIdeaBatch = (ideas: {
  project_id?: string;
  context_id?: string;
  scan_type?: string;
  category?: string;
  title: string;
  description?: string;
  effort?: number;
  impact?: number;
  risk?: number;
}[]) =>
  safeInvoke<DevIdea[]>([], "dev_tools_create_idea_batch", { ideas });

export const searchAcrossProjects = (query: string, filePattern?: string, maxResultsPerProject?: number) =>
  safeInvoke<{
    query: string;
    projects_searched: number;
    projects_with_matches: number;
    results: unknown[];
  }>(
    { query, projects_searched: 0, projects_with_matches: 0, results: [] },
    "dev_tools_search_across_projects",
    { query, filePattern, maxResultsPerProject },
  );

export const getProjectSummary = (projectId: string) =>
  safeInvoke<unknown>({}, "dev_tools_get_project_summary", { projectId });

export const getDependencyGraph = () =>
  safeInvoke<{ total_unique_deps: number; shared_deps: number; dependencies: unknown[] }>(
    { total_unique_deps: 0, shared_deps: 0, dependencies: [] },
    "dev_tools_get_dependency_graph",
  );

// ============================================================================
// Implementation Pipeline (Direction 3)
// ============================================================================

export interface GitOperationResult {
  success: boolean;
  message: string;
  branch_name?: string;
  commit_hash?: string;
  files_changed?: number;
}

export interface TestRunResult {
  project_id: string;
  success: boolean;
  total_tests: number;
  passed: number;
  failed: number;
  skipped: number;
  duration_ms: number;
  output: string;
  error?: string;
}

export const createBranch = (projectId: string, branchName: string, baseBranch?: string) =>
  safeInvoke<GitOperationResult>(
    { success: false, message: 'Command not available' },
    "dev_tools_create_branch",
    { projectId, branchName, baseBranch },
  );

export const applyDiff = (projectId: string, diffContent: string) =>
  safeInvoke<GitOperationResult>(
    { success: false, message: 'Command not available' },
    "dev_tools_apply_diff",
    { projectId, diffContent },
  );

export const runTests = (projectId: string, testCommand?: string) =>
  safeInvoke<TestRunResult>(
    { project_id: projectId, success: false, total_tests: 0, passed: 0, failed: 0, skipped: 0, duration_ms: 0, output: '', error: 'Command not available' },
    "dev_tools_run_tests",
    { projectId, testCommand },
    undefined,
    300_000, // 5 min timeout for tests
  );

export const getGitStatus = (projectId: string) =>
  safeInvoke<{
    project_id: string;
    project_name: string;
    branch: string;
    is_clean: boolean;
    changed_files_count: number;
    changed_files: string[];
    recent_commits: string[];
  }>(
    { project_id: projectId, project_name: '', branch: '', is_clean: true, changed_files_count: 0, changed_files: [], recent_commits: [] },
    "dev_tools_get_git_status",
    { projectId },
  );

export const commitChanges = (projectId: string, message: string, stageAll?: boolean) =>
  safeInvoke<GitOperationResult>(
    { success: false, message: 'Command not available' },
    "dev_tools_commit_changes",
    { projectId, message, stageAll },
  );

// ============================================================================
// Portfolio Intelligence (Direction 5)
// ============================================================================

export interface ProjectHealthEntry {
  project_id: string;
  project_name: string;
  status: string;
  tech_stack?: string;
  context_count: number;
  idea_count: number;
  task_count: number;
  latest_health_score?: number;
  open_risk_count: number;
}

export interface PortfolioHealthSummary {
  total_projects: number;
  active_projects: number;
  total_ideas: number;
  pending_ideas: number;
  total_tasks: number;
  running_tasks: number;
  avg_health_score?: number;
  projects: ProjectHealthEntry[];
}

export interface TechRadarEntry {
  technology: string;
  category: string;
  project_count: number;
  project_names: string[];
  status: string;
}

export interface RiskMatrixEntry {
  project_id: string;
  project_name: string;
  risk_category: string;
  severity: string;
  description: string;
  affected_contexts: string[];
}

export const getPortfolioHealth = () =>
  safeInvoke<PortfolioHealthSummary>(
    { total_projects: 0, active_projects: 0, total_ideas: 0, pending_ideas: 0, total_tasks: 0, running_tasks: 0, projects: [] },
    "dev_tools_get_portfolio_health",
  );

export const getTechRadar = () =>
  safeInvoke<TechRadarEntry[]>([], "dev_tools_get_tech_radar");

export const getRiskMatrix = () =>
  safeInvoke<RiskMatrixEntry[]>([], "dev_tools_get_risk_matrix");
