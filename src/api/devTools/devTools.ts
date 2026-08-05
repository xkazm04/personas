import { invokeWithTimeout as invoke } from "@/lib/tauriInvoke";

import type { DevProject } from "@/lib/bindings/DevProject";
import type { SkillInstallResult } from "@/lib/bindings/SkillInstallResult";
import type { DirectoryScanResult } from "@/lib/bindings/DirectoryScanResult";
import type { DevGoal } from "@/lib/bindings/DevGoal";
import type { DevGoalSignal } from "@/lib/bindings/DevGoalSignal";
import type { DevGoalDependency } from "@/lib/bindings/DevGoalDependency";
import type { DevGoalItem } from "@/lib/bindings/DevGoalItem";
import type { GoalProgressSuggestion } from "@/lib/bindings/GoalProgressSuggestion";
import type { PendingAcceptanceGoal } from "@/lib/bindings/PendingAcceptanceGoal";
import type { PendingCounts } from "@/lib/bindings/PendingCounts";
import type { DevContextGroup } from "@/lib/bindings/DevContextGroup";
import type { DevContext } from "@/lib/bindings/DevContext";
import type { DevContextGroupRelationship } from "@/lib/bindings/DevContextGroupRelationship";
import type { DevProjectEnvConnector } from "@/lib/bindings/DevProjectEnvConnector";
import type { DevIdea } from "@/lib/bindings/DevIdea";
import type { DevScan } from "@/lib/bindings/DevScan";
import type { DevTask } from "@/lib/bindings/DevTask";
import type { DevCompetition } from "@/lib/bindings/DevCompetition";
import type { DevCompetitionSlot } from "@/lib/bindings/DevCompetitionSlot";
import type { DevStrategyStats } from "@/lib/bindings/DevStrategyStats";
import type { CompetitionSlotInput } from "@/lib/bindings/CompetitionSlotInput";
import type { ScanAgentMeta } from "@/lib/bindings/ScanAgentMeta";
import type { StaticScanConfig } from "@/lib/bindings/StaticScanConfig";
import type { StaticScanResult } from "@/lib/bindings/StaticScanResult";
import type { TriageRule } from "@/lib/bindings/TriageRule";
import type { TriagePage } from "@/lib/bindings/TriagePage";
import type { TasksPage } from "@/lib/bindings/TasksPage";
import type { AutoRunStatus } from "@/lib/bindings/AutoRunStatus";
import type { AthenaTriageBatch } from "@/lib/bindings/AthenaTriageBatch";
import type { AppliedTriage } from "@/lib/bindings/AppliedTriage";
import type { DispatchIdeasResult } from "@/lib/bindings/DispatchIdeasResult";

// ---------------------------------------------------------------------------
// Safe invoke helper — hoisted to `@/lib/utils/tauri/safeInvoke` (Wave 5).
//
// FIX: the inline copy here previously used `msg.includes("not found")`,
// which matched real `dev_tools_*` "context not found" / "project not found"
// errors and silently coerced them into empty fallbacks (0 contexts, 0
// projects). The shared helper uses an anchored `Command "<name>" not found`
// regex so only the genuine "command isn't registered" Tauri error triggers
// the fallback path.
// ---------------------------------------------------------------------------
import { safeInvoke } from "@/lib/utils/tauri/safeInvoke";

// Re-export binding types for convenience
export type { DevProject } from "@/lib/bindings/DevProject";
export type { DirectoryScanResult } from "@/lib/bindings/DirectoryScanResult";
export type { DevGoal } from "@/lib/bindings/DevGoal";
export type { DevGoalSignal } from "@/lib/bindings/DevGoalSignal";
export type { DevContextGroup } from "@/lib/bindings/DevContextGroup";
export type { DevProjectEnvConnector } from "@/lib/bindings/DevProjectEnvConnector";
export type { DevContext } from "@/lib/bindings/DevContext";
export type { DevContextGroupRelationship } from "@/lib/bindings/DevContextGroupRelationship";
export type { DevIdea } from "@/lib/bindings/DevIdea";
export type { DevScan } from "@/lib/bindings/DevScan";
export type { DevTask } from "@/lib/bindings/DevTask";
export type { ScanAgentMeta } from "@/lib/bindings/ScanAgentMeta";
export type { TriageRule } from "@/lib/bindings/TriageRule";
export type { TriagePage } from "@/lib/bindings/TriagePage";
export type { TriageCounts } from "@/lib/bindings/TriageCounts";
export type { TasksPage } from "@/lib/bindings/TasksPage";
export type { AutoRunStatus } from "@/lib/bindings/AutoRunStatus";

// ============================================================================
// Projects
// ============================================================================

export const listProjects = (status?: string) =>
  safeInvoke<DevProject[]>([], "dev_tools_list_projects", { status: status });

export const createProject = (name: string, rootPath: string, description?: string, techStack?: string, githubUrl?: string, teamId?: string) =>
  invoke<DevProject>("dev_tools_create_project", {
    name,
    rootPath,
    description: description,
    techStack: techStack,
    githubUrl: githubUrl,
    teamId: teamId,
  });

export const updateProject = (id: string, updates: { name?: string; description?: string; status?: string; techStack?: string; githubUrl?: string; monitoringCredentialId?: string | null; monitoringProjectSlug?: string | null; teamId?: string | null; prCredentialId?: string | null; testEnvUrl?: string | null; testEnvBranch?: string | null; mainBranch?: string | null; llmTrackingCredentialId?: string | null; supportCredentialId?: string | null; dataLinks?: string | null }) =>
  invoke<DevProject>("dev_tools_update_project", {
    id,
    name: updates.name,
    description: updates.description,
    status: updates.status,
    techStack: updates.techStack,
    githubUrl: updates.githubUrl,
    monitoringCredentialId: updates.monitoringCredentialId,
    monitoringProjectSlug: updates.monitoringProjectSlug,
    teamId: updates.teamId,
    // Option<Option<String>>: wrap so `null` clears, `undefined` leaves
    // untouched. The Tauri arg shape is `Some(None)` to clear / `Some(Some(v))`
    // to set — represented here as the value or null.
    prCredentialId: updates.prCredentialId,
    // Option<Option<String>> like prCredentialId above: a string SETS the
    // living test-environment URL/branch, `null` CLEARS, `undefined` leaves
    // untouched.
    testEnvUrl: updates.testEnvUrl,
    testEnvBranch: updates.testEnvBranch,
    // Option<Option<String>> like the test-env fields: a string SETS the
    // project's primary/default branch, `null` CLEARS, `undefined` leaves it.
    mainBranch: updates.mainBranch,
    // Option<Option<String>>: binds the LLM-observability connector credential
    // (distinct slot from monitoring). String SETS, null CLEARS, undefined leaves.
    llmTrackingCredentialId: updates.llmTrackingCredentialId,
    // Option<Option<String>>: the incoming customer-support channel credential
    // (passport Support dimension). String SETS, null CLEARS, undefined leaves.
    supportCredentialId: updates.supportCredentialId,
    // Option<Option<String>>: JSON array of related dev_project ids whose code
    // post-processes this project's data (passport Data-analysis dimension).
    dataLinks: updates.dataLinks,
  });

/** Set or clear the project's standards & branching policy (Pipeline Stage 3).
 *  `config` is the JSON envelope `{ precommit, branching }` as a string, or null to clear. */
export const setStandardsConfig = (projectId: string, config: string | null) =>
  invoke<DevProject>("dev_tools_set_standards_config", { projectId, config });

/** Run the golden-standard LLM scan (Stage 3b). Returns the scan id; findings
 *  land in dev_standards and a `dev_tools_standards_scan_status` event fires. */
export const runStandardsScan = (projectId: string) =>
  invoke<{ scan_id: string }>("dev_tools_run_standards_scan", { projectId });

export const listStandards = (projectId: string) =>
  invoke<import("@/lib/bindings/DevStandard").DevStandard[]>("dev_tools_list_standards", { projectId });

/** Retrofit the PR-test-merge capability onto existing QA Guardian instances
 *  (Stage 3d backfill). Idempotent. Returns a summary of what was wired. */
export const backfillQaPrReview = () =>
  invoke<{ personas_matched: number; use_cases_added: number; subscriptions_added: number; persona_names: string[]; github_credentials_in_vault: number }>(
    "dev_tools_backfill_qa_pr_review",
    {},
  );

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

export const updateGoal = (id: string, updates: { title?: string; description?: string; status?: string; progress?: number; targetDate?: string; contextId?: string; kpiId?: string | null }) =>
  invoke<DevGoal>("dev_tools_update_goal", {
    id,
    title: updates.title,
    description: updates.description,
    status: updates.status,
    progress: updates.progress,
    targetDate: updates.targetDate,
    contextId: updates.contextId,
    // `undefined` → leave untouched; `null` → unlink; string → link.
    // The Rust side reads Option<Option<String>>, so a present-but-null value
    // clears kpi_id while an absent key leaves it as-is.
    kpiId: updates.kpiId,
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
// Goal Items (lightweight ad-hoc checklist) + hybrid progress resolver
// ============================================================================

export const listGoalItems = (goalId: string) =>
  safeInvoke<DevGoalItem[]>([], "dev_tools_list_goal_items", { goalId });

export const createGoalItem = (goalId: string, title: string) =>
  invoke<DevGoalItem>("dev_tools_create_goal_item", { goalId, title });

export const updateGoalItem = (id: string, updates: { title?: string; done?: boolean }) =>
  invoke<DevGoalItem>("dev_tools_update_goal_item", {
    id,
    title: updates.title,
    done: updates.done,
  });

export const deleteGoalItem = (id: string) =>
  invoke<boolean>("dev_tools_delete_goal_item", { id });

export const reorderGoalItems = (ids: string[]) =>
  invoke<void>("dev_tools_reorder_goal_items", { ids });

// Goal-UAT browser-test gate (web projects only) -----------------------------

/** Attach/replace a goal's browser-test UAT gate (web projects only). */
export const setGoalVerification = (goalId: string, scenario: string, url?: string) =>
  invoke<DevGoalItem>("dev_tools_set_goal_verification", { goalId, scenario, url });

/** Remove a goal's browser-test UAT gate. Returns whether one was removed. */
export const clearGoalVerification = (goalId: string) =>
  invoke<boolean>("dev_tools_clear_goal_verification", { goalId });

/** Run the goal's browser UAT now (requires all other to-dos done). */
export const runGoalUat = (goalId: string) =>
  invoke<string>("dev_tools_run_goal_uat", { goalId });

/** Close the goal's UAT gate (ticks the verify item); returns new progress. */
export const completeGoalUat = (goalId: string) =>
  invoke<number>("dev_tools_complete_goal_uat", { goalId });

export const listChildGoals = (parentGoalId: string) =>
  safeInvoke<DevGoal[]>([], "dev_tools_list_child_goals", { parentGoalId });

/** Hybrid progress: composes checklist items + sub-goals + linked team-assignment
 *  steps into a suggested %. Read-only — the UI surfaces it as an accept/edit nudge. */
export const resolveGoalProgress = (goalId: string) =>
  invoke<GoalProgressSuggestion>("dev_tools_resolve_goal_progress", { goalId });

// ============================================================================
// Goals v2 — cross-project surfaces (Timeline / Map)
// ============================================================================

/** Every goal across all projects — backs the Board/Timeline "All projects" scope. */
export const listAllGoals = () =>
  invoke<DevGoal[]>("dev_tools_list_all_goals", {});

/** Goals awaiting acceptance (enriched: project + owning team + served KPI). */
export const listPendingAcceptance = () =>
  invoke<PendingAcceptanceGoal[]>("dev_tools_list_pending_acceptance", {});

/** Count of goals awaiting acceptance — backs the goals board's own badge. */
export const countPendingAcceptance = () =>
  invoke<number>("dev_tools_count_pending_acceptance", {});

/**
 * Every "a human must decide this" queue's pending count, in one round-trip —
 * backs the title-bar review badge.
 *
 * Six DB-backed sources (goals, manual reviews, ideas, practices, policy
 * proposals, promotion proposals) and their sum. Build questions are NOT here
 * and cannot be: they live in the frontend's `buildSessions` state, so the
 * caller adds them on top of `total`.
 */
export const pendingCounts = () =>
  invoke<PendingCounts>("dev_tools_pending_counts", {});

/** Accept (→ done, off-board) or reject (→ in-progress, with a comment) a goal. */
export const resolveGoalAcceptance = (goalId: string, decision: "accept" | "reject", comment?: string) =>
  invoke<DevGoal>("dev_tools_resolve_goal_acceptance", { goalId, decision, comment });

/** All dependency edges for one project's goals in a single query (Map). */
export const listGoalDependenciesForProject = (projectId: string) =>
  invoke<DevGoalDependency[]>("dev_tools_list_goal_dependencies_for_project", { projectId });

/** All checklist items for one project's goals in a single query (Board card todos). */
export const listGoalItemsForProject = (projectId: string) =>
  safeInvoke<DevGoalItem[]>([], "dev_tools_list_goal_items_for_project", { projectId });

/** [goalId, teamName] for goals a team_assignment is advancing — the goal Map's "advancing team" badge (O4). Returns [] on failure (viz-only). */
export const goalAdvancingTeams = () =>
  safeInvoke<[string, string][]>([], "dev_tools_goal_advancing_teams", {});

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

/** No arg = full-fleet regeneration; `projectId` = scoped rescan (only that
 *  project re-aggregates; the rest carry over from the cached map). */
export const generateCrossProjectMetadata = (projectId?: string) =>
  invoke<CrossProjectMetadataMap>("dev_tools_generate_cross_project_metadata", projectId ? { projectId } : {});

export const getCrossProjectMetadata = () =>
  safeInvoke<CrossProjectMetadataMap | null>(null, "dev_tools_get_cross_project_metadata");

/** Deterministic, no-LLM repo evidence (D1) — backs the passport derive with real
 *  file signals. Hand-typed to mirror the Rust `RepoEvidence` (snake_case serde).
 *  `safeInvoke` returns null on older builds where the command isn't registered,
 *  so the derive falls back to its heuristics. */
export interface RepoEvidence {
  scanned: boolean;
  has_package_json: boolean;
  package_scripts: string[];
  test_framework: string | null;
  has_tests: boolean;
  test_file_count: number;
  auth_method: string | null;
  ci_workflows: string[];
  has_claude_md: boolean;
  has_readme: boolean;
  has_security_md: boolean;
  has_dockerfile: boolean;
  has_dependabot: boolean;
  has_codeql: boolean;
  has_migrations: boolean;
  has_eval: boolean;
  /** Agent memory + docs signals (Brainiac-adoption P0). Optional so a derive
   *  against an older backend (fields absent from the IPC payload) degrades to
   *  "no signal" instead of lying. */
  has_repo_memory?: boolean;
  memory_file_count?: number;
  memory_index_lines?: number;
  memory_age_days?: number | null;
  docs_file_count?: number;
  has_doc_map?: boolean;
  /** Design-system probe (passport "Design system" row). A root DESIGN.md at
   *  the portable spec location, whether it carries the YAML token
   *  frontmatter, and whether design guidance exists somewhere non-standard.
   *  Optional for the same older-backend reason as the fields above. */
  has_design_md?: boolean;
  design_md_has_tokens?: boolean;
  has_informal_design_doc?: boolean;
  /** Raw `app-cost.json` contents (user-maintained monthly-cost ledger at the
   *  repo root), null when the file doesn't exist. Optional for the same
   *  older-backend reason as the fields above. */
  app_cost_raw?: string | null;
  /** Application frameworks detected from the dependency manifests
   *  (package.json exact dep names, Cargo.toml) with cleaned versions —
   *  "Next.js 15.3" instead of the tech-layer heuristic's bare "React".
   *  Optional for the older-backend reason above. */
  frameworks?: Array<{ name: string; version: string | null }>;
}

export const probeRepoEvidence = (rootPath: string) =>
  safeInvoke<RepoEvidence | null>(null, "dev_tools_probe_repo_evidence", { rootPath });

// ============================================================================
// Competitions (multi-clone parallel task execution via Claude Code worktrees)
// ============================================================================

export interface CompetitionDetail {
  competition: DevCompetition;
  slots: { slot: DevCompetitionSlot; task: DevTask | null }[];
}

export const startCompetition = (
  projectId: string,
  taskTitle: string,
  taskDescription: string | null,
  sourceIdeaId: string | null,
  sourceGoalId: string | null,
  slots: CompetitionSlotInput[],
  worktreeBaseRef: 'head' | 'fresh' | null = null,
) =>
  invoke<{ competition: DevCompetition; slots: DevCompetitionSlot[] }>(
    "dev_tools_start_competition",
    {
      projectId,
      taskTitle,
      taskDescription: taskDescription,
      sourceIdeaId: sourceIdeaId,
      sourceGoalId: sourceGoalId,
      slots,
      worktreeBaseRef: worktreeBaseRef,
    },
  );

export const listCompetitions = (projectId: string, status?: string) =>
  safeInvoke<DevCompetition[]>([], "dev_tools_list_competitions", {
    projectId,
    status: status,
  });

export const getCompetition = (id: string) =>
  invoke<CompetitionDetail>("dev_tools_get_competition", { id });

export const pickCompetitionWinner = (
  id: string,
  winnerTaskId: string,
  reviewerNotes: string | null,
  winnerInsight: string | null,
) =>
  invoke<DevCompetition>("dev_tools_pick_competition_winner", {
    id,
    winnerTaskId,
    reviewerNotes: reviewerNotes,
    winnerInsight: winnerInsight,
  });

export const cancelCompetition = (id: string) =>
  invoke<DevCompetition>("dev_tools_cancel_competition", { id });

export const refreshCompetitionSlot = (slotId: string) =>
  invoke<DevCompetitionSlot>("dev_tools_refresh_competition_slot", { slotId });

export const getCompetitionSlotDiff = (slotId: string) =>
  invoke<string>("dev_tools_get_competition_slot_diff", { slotId });

export const getStrategyLeaderboard = (projectId: string) =>
  safeInvoke<DevStrategyStats[]>([], "dev_tools_get_strategy_leaderboard", {
    projectId,
  });

export const deleteCompetition = (id: string) =>
  invoke<boolean>("dev_tools_delete_competition", { id });

export const startSlotServer = (slotId: string) =>
  invoke<{ status: string; port: number; pid: number; url: string; command?: string }>(
    "dev_tools_start_slot_server",
    { slotId },
  );

export const stopSlotServer = (slotId: string) =>
  invoke<boolean>("dev_tools_stop_slot_server", { slotId });

export const switchToWorktree = (slotId: string) =>
  invoke<{ worktree_path: string; branch_name: string; project_root: string }>(
    "dev_tools_switch_to_worktree",
    { slotId },
  );

/** Parsed diff stats JSON stored on each slot. */
export interface CompetitionSlotDiffStats {
  files_changed: number;
  lines_added: number;
  lines_removed: number;
}

export function parseCompetitionSlotDiffStats(
  slot: DevCompetitionSlot,
): CompetitionSlotDiffStats | null {
  if (!slot.diff_stats_json) return null;
  try {
    const parsed = JSON.parse(slot.diff_stats_json) as CompetitionSlotDiffStats;
    return parsed;
  } catch {
    return null;
  }
}

// ============================================================================
// Context Groups
// ============================================================================

/** R21 — the project's favicon as a data URL (well-known frontend/Tauri
 *  locations probed on the Rust side); null when none exists. */
export const getProjectFavicon = (rootPath: string) =>
  safeInvoke<string | null>(null, "dev_tools_get_project_favicon", { rootPath });

export const listContextGroups = (projectId: string) =>
  safeInvoke<DevContextGroup[]>([], "dev_tools_list_context_groups", { projectId });

// -- per-environment connector bindings --------------------------------------
// `dev_projects` has four SINGULAR credential slots, which cannot express "a
// different database per environment" or "a different monitoring backend per
// capability". These read/write the `(project, dimension, env)` table instead.
// `dimension` is a passport row key, optionally capability-suffixed
// ('persistence', 'monitoring', 'monitoring.logs'); `env` is an EnvKey.

export const listEnvConnectors = (projectId: string) =>
  safeInvoke<DevProjectEnvConnector[]>([], "dev_tools_list_env_connectors", { projectId });

/** Bind a credential to one (dimension, env) pair. `credentialId: null` clears
 *  it — assigning and unassigning are the same gesture, so the same call. */
export const setEnvConnector = (
  projectId: string,
  dimension: string,
  env: string,
  credentialId: string | null,
) =>
  invoke<void>("dev_tools_set_env_connector", { projectId, dimension, env, credentialId });

export const createContextGroup = (projectId: string, name: string, color: string, icon?: string, groupType?: string, domain?: string) =>
  invoke<DevContextGroup>("dev_tools_create_context_group", {
    projectId,
    name,
    color,
    icon: icon,
    groupType: groupType,
    domain: domain,
  });

export const updateContextGroup = (id: string, updates: { name?: string; color?: string; icon?: string; groupType?: string; healthScore?: number; domain?: string }) =>
  invoke<DevContextGroup>("dev_tools_update_context_group", {
    id,
    name: updates.name,
    color: updates.color,
    icon: updates.icon,
    groupType: updates.groupType,
    healthScore: updates.healthScore,
    domain: updates.domain,
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
  category?: string,
  businessFeature?: string,
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
    category: category,
    businessFeature: businessFeature,
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
  category?: string;
  businessFeature?: string;
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
    category: updates.category,
    businessFeature: updates.businessFeature,
  });

export const deleteContext = (id: string) =>
  invoke<boolean>("dev_tools_delete_context", { id });

export const moveContext = (id: string, targetGroupId: string | null) =>
  safeInvoke<DevContext>({} as DevContext, "dev_tools_move_context", { id, targetGroupId });

// Pin/unpin a context so a full re-scan preserves it instead of recreating it.
export const setContextPinned = (id: string, pinned: boolean) =>
  invoke<DevContext>("dev_tools_set_context_pinned", { id, pinned });

export const scanCodebase = (projectId: string, rootPath: string, deltaMode?: boolean) =>
  invoke<{ scan_id: string }>("dev_tools_scan_codebase", { projectId, rootPath, deltaMode });

export const cancelScanCodebase = (scanId: string) =>
  safeInvoke<boolean>(false, "dev_tools_cancel_scan_codebase", { scanId });

/**
 * Port the loopback `/dev-tools` bridge is listening on, or null before the
 * server has bound. Not a constant — it is the first free port at or above the
 * preferred one, so it can differ between launches. Dispatches that hand work
 * to a terminal session name it as a starting hint; the session re-probes the
 * range if that port stops answering.
 */
export const bridgePort = () =>
  safeInvoke<number | null>(null, "dev_tools_bridge_port", {});

/**
 * Status of a background scan job (context generation or idea scan).
 *
 * `error` and `lines` are OPTIONAL on purpose: the Rust handlers only include
 * them when the scan id is still in the job registry. The `not_found` branch
 * emits `{ scan_id, status }` alone, so a non-optional annotation would let a
 * poller do `result.lines.length` and throw on exactly the path it's meant to
 * handle. (The previous `error: string | null; lines: string[]` annotation was
 * wrong for that branch, which is why ContextMapPage bypassed this wrapper with
 * a correctly-optional inline type.)
 */
export interface DevToolsScanStatus {
  scan_id: string;
  status: string;
  error?: string | null;
  lines?: string[];
}

export const getScanCodebaseStatus = (scanId: string) =>
  // "unavailable" (command not registered in this build) must stay distinct from
  // the real "not_found" status the backend returns for an unknown/expired scan
  // id — otherwise a scan that never started masquerades as one that simply
  // ended, and a poller can't tell the two apart.
  safeInvoke<DevToolsScanStatus>(
    { scan_id: scanId, status: "unavailable", error: null, lines: [] },
    "dev_tools_get_scan_codebase_status",
    { scanId },
  );

/** Idea-scanner counterpart of {@link getScanCodebaseStatus}; same contract. */
export const getIdeaScanStatus = (scanId: string) =>
  safeInvoke<DevToolsScanStatus>(
    { scan_id: scanId, status: "unavailable", error: null, lines: [] },
    "dev_tools_get_idea_scan_status",
    { scanId },
  );

export const generateContextDescription = (contextId: string) =>
  safeInvoke<DevContext>({} as DevContext, "dev_tools_generate_context_description", { contextId }, undefined, 60_000);

// Advisory context-balance audit. Mirrors the Rust `ContextAuditReport`
// (commands/infrastructure/context_audit.rs). Typed inline so the frontend
// compiles before the ts_rs bindings are regenerated.
export interface ContextAuditFinding {
  severity: "error" | "warn" | "info";
  kind: string;
  target: string;
  message: string;
}
export interface ContextAuditTotals {
  groups: number;
  contexts: number;
  files_mapped: number;
  uncategorized_contexts: number;
  groups_missing_domain: number;
  overlapping_files: number;
  dangling_files: number;
  unresolved_cross_refs: number;
  stale_contexts: number;
}
export interface ContextAuditReport {
  project_id: string;
  generated_at: string;
  balanced: boolean;
  totals: ContextAuditTotals;
  findings: ContextAuditFinding[];
}

const EMPTY_AUDIT: ContextAuditReport = {
  project_id: "",
  generated_at: "",
  balanced: true,
  totals: {
    groups: 0,
    contexts: 0,
    files_mapped: 0,
    uncategorized_contexts: 0,
    groups_missing_domain: 0,
    overlapping_files: 0,
    dangling_files: 0,
    unresolved_cross_refs: 0,
    stale_contexts: 0,
  },
  findings: [],
};

export const auditContexts = (projectId: string) =>
  safeInvoke<ContextAuditReport>(EMPTY_AUDIT, "dev_tools_audit_contexts", { projectId });

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

// -- the findings spine (docs/plans/dev-findings-loop.md) --------------------

/** The sensors that can raise a finding. Mirrors `FINDING_ORIGINS` in Rust. */
export const FINDING_ORIGINS = [
  "standards_finding",
  "passport_gap",
  "llm_cost",
  "sentry_spike",
  "kpi_offtrack",
  "skill_dormant",
  "doc_rot",
  "kpi_sim",
  "memory_disputed",
  // Not a measurement sensor — the Workspace Knowledge Center materializing an
  // adopted practice as one backlog item per member repo (plan 1C).
  "workspace_practice",
  // scan-sweep skill findings + deep-scan escalations (memory-outbox door).
  "scan_sweep",
] as const;
export type FindingOrigin = (typeof FINDING_ORIGINS)[number];

export interface CreateFindingInput {
  projectId: string;
  origin: FindingOrigin;
  title: string;
  description?: string;
  category?: string;
  contextId?: string;
  useCaseId?: string;
  /** JSON string — the raw numbers that justified emission. */
  evidence?: string;
  dedupKey: string;
  effort?: number;
  impact?: number;
  risk?: number;
}

/** Raise a sensor finding. Resolves to `null` when `dedupKey` already exists on
 *  the project in ANY status (idempotent — a human "no" is durable). */
export const createFinding = (input: CreateFindingInput) =>
  invoke<DevIdea | null>("dev_tools_create_finding", { ...input });

/** Every dedup key already spoken for on this project — the sweep's pre-filter. */
export const listFindingDedupKeys = (projectId: string) =>
  safeInvoke<string[]>([], "dev_tools_list_finding_dedup_keys", { projectId });

// -- verification (Phase 3A) --------------------------------------------------

/** Did shipping the work move the signal? `unchanged`/`regressed` are real
 *  outcomes — "merged" is not the same as "fixed". */
export const VERIFY_STATES = ["pending", "cleared", "moved", "unchanged", "regressed"] as const;
export type VerifyState = (typeof VERIFY_STATES)[number];

/** Record a verdict. `verifyEvidence` is the RE-MEASURED reading (JSON string), so
 *  the verdict can be audited against the finding's original `evidence`. */
export const setFindingVerifyState = (
  id: string,
  verifyState: VerifyState,
  verifyEvidence?: string,
) => invoke<void>("dev_tools_set_finding_verify_state", { id, verifyState, verifyEvidence });

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

export interface RunScanOptions {
  /** Single legacy context scope (per-context "scan this" + auto-scan). */
  contextId?: string;
  /** Multi-context scope (Scanner Configure modal). Takes precedence. */
  contextIds?: string[];
  /** Target number of findings (granularity). */
  targetCount?: number;
}

export const runScan = (projectId: string, scanTypes: string[], opts?: RunScanOptions) =>
  invoke<{ scan_id: string; scan_type: string }>("dev_tools_run_scan", {
    projectId,
    scanTypes,
    contextId: opts?.contextId,
    contextIds: opts?.contextIds,
    targetCount: opts?.targetCount,
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
// Static Scan (deterministic CLI-driven sibling to LLM idea scanner)
// ============================================================================

export const setStaticScanConfig = (projectId: string, config: StaticScanConfig | null) =>
  invoke<DevProject>("dev_tools_set_static_scan_config", {
    projectId,
    config,
  });

export const runStaticScan = (projectId: string, configOverride?: StaticScanConfig) =>
  invoke<StaticScanResult>("dev_tools_run_static_scan", {
    projectId,
    configOverride: configOverride ?? null,
  });

// ============================================================================
// Triage
// ============================================================================

export interface TriageIdeasFilters {
  /** Defaults to `pending` backend-side. */
  status?: string;
  /** `scanner` is the pseudo-origin for classic scanner ideas (`origin IS NULL`). */
  origin?: string;
  category?: string;
}

/** One keyset page of backlog ideas + facet counts.
 *
 *  Was a phantom command until the unified-Backlog work: it lived in
 *  `commandNames.overrides.ts` and `safeInvoke` silently returned an empty
 *  page, so every triage surface rendered "nothing to review" regardless of
 *  the backlog's real contents. It is a real registered command now, so this
 *  is a plain typed invoke — a missing command must surface, not fake empty.
 *
 *  `projectId` omitted = cross-project read (the unified Backlog default). */
export const triageIdeas = (projectId?: string, limit?: number, cursor?: string, filters?: TriageIdeasFilters) =>
  invoke<TriagePage>("dev_tools_triage_ideas", {
    projectId: projectId,
    status: filters?.status,
    origin: filters?.origin,
    category: filters?.category,
    limit: limit,
    cursor: cursor,
  });

/**
 * Accept a backlog idea.
 *
 * `expectedStatus` is the status the CALLING SURFACE rendered on the row. Send
 * it from anything that shows an idea and then writes a verdict against it: the
 * backend turns it into a single-winner compare-and-swap, so a verdict issued
 * from a card someone else already decided fails loudly ("already decided by a
 * concurrent action") instead of silently overwriting their verdict and firing a
 * second decision-memory + adoption-sync fan-out. Prefer
 * `decideIdeaRow` from `@/lib/decisions/rowWrites` over calling this directly.
 */
export const acceptIdea = (id: string, expectedStatus?: string) =>
  safeInvoke<DevIdea>({} as DevIdea, "dev_tools_accept_idea", { id, expectedStatus });

/** Reject a backlog idea. See {@link acceptIdea} for `expectedStatus`. */
export const rejectIdea = (id: string, reason?: string, expectedStatus?: string) =>
  safeInvoke<DevIdea>({} as DevIdea, "dev_tools_reject_idea", {
    id,
    reason: reason,
    expectedStatus,
  });

/** Pending backlog ideas across all projects — source for the Human-Review
 *  inbox's "Dev Tools backlog" group. Project names resolved from the store. */
export const listPendingIdeas = (limit?: number) =>
  safeInvoke<DevIdea[]>([], "dev_tools_list_pending_ideas", { limit });

/** Deleting a triage row IS deleting the idea — `dev_tools_delete_triage_idea`
 *  never existed on the Rust side, so this used to no-op and the row came back
 *  on the next fetch. Points at the real command. */
export const deleteTriageIdea = (id: string) =>
  invoke<boolean>("dev_tools_delete_idea", { id });

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

/** Keyset page of tasks + per-status counts for the Run Desk.
 *  `listTasks` stays for the callers that want the whole (unpaged) list. */
export const tasksPage = (projectId?: string, statuses?: string[], limit?: number, cursor?: string) =>
  invoke<TasksPage>("dev_tools_tasks_page", {
    projectId: projectId,
    statuses: statuses,
    limit: limit,
    cursor: cursor,
  });

/** Queue a fresh attempt of a task. The new row copies the original verbatim
 *  (no `[Retry] ` title prefix); lineage lives in `parent_task_id`/`attempt`. */
export const retryTask = (taskId: string) =>
  invoke<DevTask>("dev_tools_retry_task", { taskId });

export const createTask = (title: string, projectId?: string, description?: string, sourceIdeaId?: string, goalId?: string, depth?: string) =>
  invoke<DevTask>("dev_tools_create_task", {
    title,
    projectId: projectId,
    description: description,
    sourceIdeaId: sourceIdeaId,
    goalId: goalId,
    depth: depth,
  });

// -- the accept → execute bridge + Athena batch triage ----------------------

/**
 * Dispatch accepted backlog ideas to an executor.
 *
 * `runner` creates the tasks AND starts them through the existing batch
 * machinery. `fleet` creates the tasks and returns each one's project
 * `rootPath` + composed `prompt` so the caller can `spawnSession` per project
 * (the fleet arm stays frontend-composed in v1).
 *
 * Pending ideas are auto-accepted server-side — dispatching IS the decision.
 */
export const dispatchIdeas = (
  ideaIds: string[],
  target: "runner" | "fleet",
  opts?: { depth?: string; maxParallel?: number },
) =>
  invoke<DispatchIdeasResult>("dev_tools_dispatch_ideas", {
    ideaIds,
    target,
    depth: opts?.depth,
    maxParallel: opts?.maxParallel,
  });

/**
 * One headless Athena turn over up to 30 selected pending ideas. Persists the
 * verdicts as a PENDING approval and returns them for the verdict card; nothing
 * is applied until {@link applyTriageVerdicts} (or the plain Approvals card).
 */
export const athenaTriageBatch = (ideaIds: string[]) =>
  invoke<AthenaTriageBatch>("dev_tools_athena_triage_batch", { ideaIds });

/**
 * Confirm a triage batch, with per-item human overrides layered over Athena's
 * verdicts (`skip` leaves an idea untouched). Ideas are written first, the
 * approval row is closed last.
 */
export const applyTriageVerdicts = (
  approvalId: string,
  overrides: { ideaId: string; verdict: "accept" | "reject" | "skip"; reason?: string }[],
) => invoke<AppliedTriage>("dev_tools_apply_triage_verdicts", { approvalId, overrides });

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

// ── Project Memory Ledger (docs/plans/skill-memory-unification.md) ─────────

export interface MemoryIngestResult {
  nodesInserted: number;
  nodesRefreshed: number;
  edgesInserted: number;
  skipped: number;
  outboxFound: boolean;
  /** `map`-kind nodes seen — the structure-drift signal (triggers a delta context scan). */
  mapNodes: number;
  /** Scan findings routed into dev_ideas (origin `scan_sweep`). */
  findingsCreated: number;
  findingsDeduped: number;
  /** Dropped by backpressure (backlog at cap) or per-ingest line caps. */
  findingsSkipped: number;
  /** NEW deep-scan escalations — auto-dispatch `/scan-<lens> <context>` per entry (bounded). */
  escalations: { lens: string; context: string | null }[];
}

export interface MemoryVaultProjectResult {
  vaultConfigured: boolean;
  written: number;
  removed: number;
}

export interface MemoryVaultImportResult {
  vaultConfigured: boolean;
  imported: number;
  updated: number;
}

export interface MemoryNodeRow {
  id: string;
  projectId: string;
  contextId: string | null;
  kind: string;
  title: string;
  body: string | null;
  source: string;
  updatedAt: string;
}

export interface MemoryCoverage {
  contexts: number;
  covered: number;
  windowDays: number;
  unanchored: number;
}

/** Ingest `<root>/.personas/memory-outbox.jsonl` into the project's ledger.
 *  Missing outbox = zero-work success (`outboxFound: false`). */
export const ingestMemoryOutbox = (projectId: string) =>
  invoke<MemoryIngestResult>("dev_tools_memory_ingest", { projectId });

/** Refresh `<root>/.personas/backlog-digest.json` (known idea titles per
 *  status) so a scan skill dispatched next reads the CURRENT backlog. Returns
 *  the number of titles written. */
export const exportBacklogDigest = (projectId: string) =>
  invoke<number>("dev_tools_export_backlog_digest", { projectId });

/** Fresh-first active ledger nodes; `contextId` narrows to one context. */
export const listMemoryNodes = (projectId: string, contextId?: string | null, limit?: number) =>
  invoke<MemoryNodeRow[]>("dev_tools_memory_list", {
    projectId,
    contextId: contextId ?? null,
    limit: limit ?? null,
  });

/** Context coverage: contexts with fresh (≤30d) memory / all contexts. */
export const memoryCoverage = (projectId: string) =>
  invoke<MemoryCoverage>("dev_tools_memory_coverage", { projectId });

/** Project the ledger into the Obsidian vault (Brain plugin's vault; no-op
 *  with vaultConfigured=false when none is set up). */
export const projectMemoryToVault = (projectId: string) =>
  invoke<MemoryVaultProjectResult>("dev_tools_memory_project_vault", { projectId });

/** Explicit vault → ledger import scan for the project's subtree. */
export const importMemoryFromVault = (projectId: string) =>
  invoke<MemoryVaultImportResult>("dev_tools_memory_import_vault", { projectId });

export interface SkillCoverageRow {
  skill: string;
  coveredContexts: number;
  freshNodes: number;
  latestAt: string | null;
}

export interface SkillContextRow {
  contextId: string;
  name: string;
  freshNodes: number;
  latestAt: string | null;
}

/** Per-skill context coverage (30d) — one row per attributed skill. */
export const memorySkillCoverage = (projectId: string) =>
  invoke<SkillCoverageRow[]>("dev_tools_memory_skill_coverage", { projectId });

/** Per-context progress for ONE skill (0-count contexts included). */
export const memorySkillContexts = (projectId: string, skill: string) =>
  invoke<SkillContextRow[]>("dev_tools_memory_skill_contexts", { projectId, skill });

/**
 * Execute a queued Dev-runner task. `model` optionally overrides the model for
 * THIS run (e.g. skill adopt/share pins "claude-sonnet-5"); omit to keep the
 * dev-runner default Sonnet. Effort stays the app-wide default (medium).
 */
export const executeTask = (taskId: string, model?: string) =>
  invoke<{ task_id: string }>("dev_tools_execute_task", { taskId, model: model ?? null });

export const startBatchExecution = (taskIds: string[], maxParallel?: number) =>
  invoke<{ batch_id: string; started: number }>("dev_tools_start_batch", { taskIds, maxParallel });

export const cancelTaskExecution = (taskId: string) =>
  safeInvoke<boolean>(false, "dev_tools_cancel_task_execution", { taskId });

// -- Auto-Run scheduler -----------------------------------------------------

export const startAutoRun = (projectId: string, maxParallel?: number, maxIterations?: number) =>
  invoke<{ run_id: string; snapshot_size: number }>("dev_tools_start_auto_run", {
    projectId,
    maxParallel,
    maxIterations,
  });

export const cancelAutoRun = (runId: string) =>
  safeInvoke<boolean>(false, "dev_tools_cancel_auto_run", { runId });

/** Durable auto-run state for the Run Desk banner — the last `dev_auto_runs`
 *  row for the project, flagged `live` when the in-memory scheduler still owns
 *  it. Lets the banner rehydrate after a reload instead of forgetting the run. */
export const getAutoRunStatus = (projectId?: string) =>
  invoke<AutoRunStatus>("dev_tools_get_auto_run_status", { projectId: projectId ?? null });

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

// ============================================================================
// Skill Files
// ============================================================================

export interface SkillEntry {
  name: string;
  path: string;
  description: string | null;
  referenceFileCount: number;
  referenceFiles: string[];
  /** Provenance-derived drift state: 'in_sync' | 'diverged' | 'local_only'. */
  syncState: string;
  /** Where the skill was installed from ('global' | 'project'), or null. */
  sourceKind: string | null;
  /** Canonical category from SKILL.md frontmatter (`category:` — one of
   *  Development/Testing/Maintenance/Data/Other), or null → grouped as Other. */
  category: string | null;
  /** Memory binding from SKILL.md frontmatter (`memory:` — 'project' | 'vault'
   *  | 'none'), or null = undeclared → dispatches carry no MEMORY BLOCK. */
  memory: string | null;
  /** Frontmatter `contexts: tracked` — the skill declares it walks the context
   *  map and anchors its memory per context (coverage rows in the Skills UI). */
  contextTracked: boolean;
}

export interface SkillFileContent {
  skillName: string;
  fileName: string;
  content: string;
}

export interface SkillFileDelta {
  file: string;
  /** 'changed' | 'added' | 'removed'. */
  status: string;
  sourceBytes: number;
  targetBytes: number;
}

export interface SkillInstallPreview {
  skillName: string;
  targetPath: string;
  targetExists: boolean;
  changedCount: number;
  addedCount: number;
  removedCount: number;
  deltas: SkillFileDelta[];
}

export const listSkills = (projectId?: string | null) =>
  safeInvoke<SkillEntry[]>([], "skill_files_list", { projectId: projectId ?? null });

/** List skills from the user-global library (`~/.claude/skills`). */
export const listSkillsGlobal = () =>
  safeInvoke<SkillEntry[]>([], "skill_files_list_global", {});

/**
 * Install (copy) a skill into a target project's `.claude/skills`.
 * `sourceProjectId = null` copies from the global library. With
 * `overwrite = false`, an existing target skill is left untouched
 * (result.installed === false, result.reason === "exists").
 */
export const installSkill = (
  skillName: string,
  sourceProjectId: string | null,
  targetProjectId: string,
  overwrite: boolean,
) =>
  invoke<SkillInstallResult>("skill_files_install", {
    skillName,
    sourceProjectId,
    targetProjectId,
    overwrite,
  });

/**
 * Install an app-owned SYSTEM skill (e.g. passport-onboard) into a target
 * project, sourced from the app bundle / repo `.claude/skills` instead of the
 * user's global library — so it resolves on a fresh clone and a clean
 * installer. Only skills in the backend SYSTEM_SKILLS allowlist are accepted.
 */
export const installSystemSkill = (
  skillName: string,
  targetProjectId: string,
  overwrite: boolean,
) =>
  invoke<SkillInstallResult>("skill_files_install_system", {
    skillName,
    targetProjectId,
    overwrite,
  });

/**
 * Preview what a (re-)install would change at the target, without writing.
 * Returns per-file deltas + counts so the UI can summarize an overwrite before
 * committing it.
 */
export const previewInstallSkill = (
  skillName: string,
  sourceProjectId: string | null,
  targetProjectId: string,
) =>
  invoke<SkillInstallPreview>("skill_files_install_preview", {
    skillName,
    sourceProjectId,
    targetProjectId,
  });

// -- skill usage telemetry (Brainiac-adoption P1) -----------------------------

/** One registry row + its usage aggregates. Hand-typed to mirror the Rust
 *  `SkillUsageRow` (snake_case serde). Project rows count their own project's
 *  invokes; global rows count the name across all projects. */
export interface SkillUsageRow {
  name: string;
  scope: 'global' | 'project';
  project_id: string | null;
  content_hash: string | null;
  description: string | null;
  first_seen_at: string;
  last_changed_at: string;
  missing_since: string | null;
  invokes_30d: number;
  last_invoked_at: string | null;
  /** Age-guarded: present ≥30d AND zero invokes in the window. */
  dormant: boolean;
}

/** Incremental transcript-mining sweep + registry reconcile. Idempotent;
 *  bounded per call (`exhausted` = call again to continue). Generous timeout —
 *  the FIRST run parses up to ~48MB of transcript history. */
export const scanSkillUsage = () =>
  invoke<{ files_scanned: number; events_added: number; exhausted: boolean }>(
    "skill_usage_scan",
    {},
    undefined,
    120_000,
  );

export const getSkillUsageOverview = () =>
  safeInvoke<SkillUsageRow[]>([], "skill_usage_overview", {});

// -- doc-rot telemetry (Brainiac-adoption P2) ---------------------------------

/** One tracked doc + its rot state and read aggregates. Mirrors the Rust
 *  `DocRotRow` (snake_case). `unscoped` = no coupling known (doc-map or
 *  referenced paths) — tracked but never dirty-able. */
export interface DocRotRow {
  project_id: string;
  doc_path: string;
  unscoped: boolean;
  last_doc_commit: string | null;
  last_source_commit: string | null;
  /** The local dirty_at — set while coupled sources are newer than the doc. */
  dirty_since: string | null;
  changed_sources: string[];
  scanned_at: string;
  reads_30d: number;
  /** Reads that happened while the doc was already dirty — rot being consumed. */
  dirty_reads_30d: number;
  last_read_at: string | null;
}

/** Git-based doc-rot scan over every registered project. Throttled per project
 *  (6h) unless `force`; one bounded `git log` per repo. */
export const scanDocRot = (force = false) =>
  invoke<{ projects_scanned: number; docs_tracked: number; dirty: number }>(
    "doc_rot_scan",
    { force },
    undefined,
    120_000,
  );

export const getDocRotOverview = () =>
  safeInvoke<DocRotRow[]>([], "doc_rot_overview", {});

// -- knowledge-health snapshots + disputed memories (Brainiac-adoption P3) ----

/** Latest per-project memory-health snapshot + live disputed count. Mirrors
 *  the Rust `MemoryHealthRow` (snake_case). */
export interface MemoryHealthRow {
  project_id: string;
  score: number;
  prev_score: number | null;
  currency: number;
  consistency: number;
  governance: number;
  stale_count: number;
  total_count: number;
  open_claims: number;
  disputed: number;
  captured_at: string;
}

/** One disputed memory projected onto a dev project (the `memory_disputed`
 *  findings sensor). Mirrors the Rust `DisputedMemoryRow`. */
export interface DisputedMemoryRow {
  project_id: string;
  memory_id: string;
  memory_title: string;
  persona_id: string;
  persona_name: string;
  open_claims: number;
  latest_verdict: string | null;
  latest_note: string | null;
  last_claim_at: string | null;
}

/** Snapshot the memory health of every team-bound project (6h throttle per
 *  project unless `force`). Append-only trend points. */
export const scanMemoryHealth = (force = false) =>
  invoke<{ projects_scanned: number }>("memory_health_scan", { force }, undefined, 60_000);

export const getMemoryHealthOverview = () =>
  safeInvoke<MemoryHealthRow[]>([], "memory_health_overview", {});

export const getMemoryDisputedOverview = () =>
  safeInvoke<DisputedMemoryRow[]>([], "memory_disputed_overview", {});

export const readSkillFile = (skillName: string, fileName: string, projectId?: string | null) =>
  invoke<SkillFileContent>("skill_files_read", { skillName, fileName, projectId: projectId ?? null });

export const writeSkillFile = (
  skillName: string,
  fileName: string,
  content: string,
  projectId?: string | null,
) =>
  invoke<void>("skill_files_write", { skillName, fileName, content, projectId: projectId ?? null });
