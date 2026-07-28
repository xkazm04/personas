// Workspace Knowledge Center API (docs/plans/workspace-knowledge-center.md) —
// wrappers over the dev_tools_workspace_* Tauri commands. Workspaces group dev
// projects (single workspace per project via dev_projects.workspace_id);
// workspace_knowledge is the governed cross-project practice library
// (observed → proposed → adopted ladder, agents propose / humans adopt);
// workspace_practice_adoption is the per-project adoption matrix.
import { invokeWithTimeout as invoke } from "@/lib/tauriInvoke";

import type { DevProject } from "@/lib/bindings/DevProject";
import type { DevWorkspace } from "@/lib/bindings/DevWorkspace";
import type { HarvestPrepared } from "@/lib/bindings/HarvestPrepared";
import type { IngestSummary } from "@/lib/bindings/IngestSummary";
import type { ProjectionResult } from "@/lib/bindings/ProjectionResult";
import type { WorkspaceImportItem } from "@/lib/bindings/WorkspaceImportItem";
import type { WorkspaceKnowledge } from "@/lib/bindings/WorkspaceKnowledge";
import type { BulkDecision } from "@/lib/bindings/BulkDecision";
import type { WorkspaceHarvestCoverage } from "@/lib/bindings/WorkspaceHarvestCoverage";
import type { WorkspacePracticeAdoption } from "@/lib/bindings/WorkspacePracticeAdoption";

export type KnowledgeKind = "pattern" | "pitfall" | "decision" | "howto" | "fact";
export type KnowledgeStatus = "observed" | "proposed" | "adopted" | "deprecated" | "rejected";
export type KnowledgeDecision = "propose" | "adopt" | "reject" | "deprecate";
export type AdoptionState =
  | "na"
  | "proposed"
  | "to_process"
  | "dispatched"
  | "adopted"
  | "diverged";

/**
 * Kinds whose adoption implies WORK inside a member repo rather than a note to
 * carry: a `pitfall` names something to remove, a `pattern` names something to
 * converge on. Adopting one seeds every applicable member repo's adoption cell
 * at `to_process` — the queue an executor drains — instead of the passive
 * `proposed`. Mirrors `ACTIONABLE_KINDS` in
 * src-tauri/src/db/repos/dev_workspaces.rs; keep the two in step.
 */
export const ACTIONABLE_KINDS: readonly KnowledgeKind[] = ["pitfall", "pattern"];

export function isActionableKind(kind: string): boolean {
  return (ACTIONABLE_KINDS as readonly string[]).includes(kind);
}

/** Parsed shape of `WorkspaceKnowledge.applicability` (stored as JSON text). */
export interface Applicability {
  layers?: string[];
  languages?: string[];
  frameworks?: string[];
  conditions?: string[];
}

// -- workspaces --------------------------------------------------------------

export async function listWorkspaces(): Promise<DevWorkspace[]> {
  return invoke<DevWorkspace[]>("dev_tools_workspace_list", {});
}

export async function createWorkspace(
  name: string,
  color?: string,
  description?: string,
): Promise<DevWorkspace> {
  return invoke<DevWorkspace>("dev_tools_workspace_create", { name, color, description });
}

/** Field-wise update. `null` clears a nullable column; `undefined` leaves it unchanged. */
export async function updateWorkspace(
  id: string,
  patch: { name?: string; color?: string | null; description?: string | null },
): Promise<DevWorkspace> {
  return invoke<DevWorkspace>("dev_tools_workspace_update", { id, ...patch });
}

/** Delete a workspace. Member projects are unassigned, never deleted. */
export async function deleteWorkspace(id: string): Promise<boolean> {
  return invoke<boolean>("dev_tools_workspace_delete", { id });
}

/** Move a project into a workspace (or out of every one when `null`). */
export async function assignProjectToWorkspace(
  projectId: string,
  workspaceId: string | null,
): Promise<DevProject> {
  return invoke<DevProject>("dev_tools_workspace_assign_project", { projectId, workspaceId });
}

/** One-time import of the localStorage prototype (idempotent on name). */
export async function importLocalWorkspaces(
  items: WorkspaceImportItem[],
): Promise<DevWorkspace[]> {
  return invoke<DevWorkspace[]>("dev_tools_workspace_import_local", { items });
}

// -- knowledge ---------------------------------------------------------------

export async function listWorkspaceKnowledge(
  workspaceId: string,
  status?: KnowledgeStatus,
): Promise<WorkspaceKnowledge[]> {
  return invoke<WorkspaceKnowledge[]>("dev_tools_workspace_knowledge_list", {
    workspaceId,
    status,
  });
}

export interface CreateKnowledgeInput {
  workspaceId: string;
  kind: KnowledgeKind;
  title: string;
  statement: string;
  detailMd?: string;
  /** Slash-path taxonomy node, e.g. 'ui/motion/reveals'. */
  topic?: string;
  /** JSON-encoded {@link Applicability}. */
  applicability?: string;
  originProjectId?: string;
}

/** Author a practice by hand — lands as `proposed` with human provenance. */
export async function createWorkspaceKnowledge(
  input: CreateKnowledgeInput,
): Promise<WorkspaceKnowledge> {
  return invoke<WorkspaceKnowledge>("dev_tools_workspace_knowledge_create", { ...input });
}

/** Field-wise update. `null` clears a nullable column; `undefined` leaves it unchanged. */
export async function updateWorkspaceKnowledge(
  id: string,
  patch: {
    kind?: KnowledgeKind;
    title?: string;
    statement?: string;
    detailMd?: string | null;
    topic?: string | null;
    applicability?: string | null;
  },
): Promise<WorkspaceKnowledge> {
  return invoke<WorkspaceKnowledge>("dev_tools_workspace_knowledge_update", { id, ...patch });
}

/**
 * The governance gate. `adopt` fans the practice out to every member project
 * as its to-adopt queue; `reject` keeps the row for miner dedup;
 * `deprecate` optionally records a successor.
 */
export async function decideWorkspaceKnowledge(
  id: string,
  decision: KnowledgeDecision,
  supersededBy?: string,
): Promise<WorkspaceKnowledge> {
  return invoke<WorkspaceKnowledge>("dev_tools_workspace_knowledge_decide", {
    id,
    decision,
    supersededBy,
  });
}

/**
 * Adjudicate many practices at once.
 *
 * A twelve-territory harvest lands a few hundred `observed` items; at one modal
 * per item the review queue is measured in hours and the governance pillar
 * never moves. Same gate as the single decide — only the batch size changes.
 * Per-item failures come back in `failed` rather than sinking the batch.
 */
export async function decideWorkspaceKnowledgeBulk(
  ids: string[],
  decision: KnowledgeDecision,
): Promise<BulkDecision> {
  return invoke<BulkDecision>("dev_tools_workspace_knowledge_decide_bulk", { ids, decision });
}

/** Derive `governing_id` across a workspace: within each topic, the macro
 *  doctrine adopts its instances. Runs automatically after ingest. */
export async function rollUpDoctrine(workspaceId: string): Promise<number> {
  return invoke<number>("dev_tools_workspace_roll_up_doctrine", { workspaceId });
}

export async function deleteWorkspaceKnowledge(id: string): Promise<boolean> {
  return invoke<boolean>("dev_tools_workspace_knowledge_delete", { id });
}

// -- adoption matrix ---------------------------------------------------------

export async function listWorkspaceAdoption(
  workspaceId: string,
): Promise<WorkspacePracticeAdoption[]> {
  return invoke<WorkspacePracticeAdoption[]>("dev_tools_workspace_adoption_list", {
    workspaceId,
  });
}

export async function setWorkspaceAdoption(
  practiceId: string,
  projectId: string,
  adoptionState: AdoptionState,
  note?: string,
  fleetKey?: string,
): Promise<WorkspacePracticeAdoption> {
  return invoke<WorkspacePracticeAdoption>("dev_tools_workspace_adoption_set", {
    practiceId,
    projectId,
    adoptionState,
    note,
    fleetKey,
  });
}

/**
 * Reconcile the adoption queue against the backlog: every `to_process` cell of
 * an adopted actionable practice that has no materialized idea yet gets one
 * (one `dev_idea` per member project, `origin: 'workspace_practice'`).
 *
 * Idempotent — dedup-gated per `(project_id, dedup_key)` — so calling it twice
 * creates nothing the second time. Also runs once at app start; this wrapper
 * exists for queues seeded by paths that predate materialization, so the user
 * never has to re-adopt a practice to unstick its backlog. Returns the number
 * of ideas created.
 */
export async function backfillPracticeIdeas(): Promise<number> {
  return invoke<number>('dev_tools_workspace_backfill_practice_ideas', {});
}

// -- extraction engine (Arc 2) -----------------------------------------------

export type { IngestSummary, WorkspaceHarvestCoverage };

/** Run the deterministic (no-LLM) miners over a workspace and ingest their
 *  candidates as `observed` knowledge with miner provenance. Cheap signal
 *  before any harvest-skill LLM spend. Idempotent (dedup-gated). */
export async function runWorkspaceMiners(workspaceId: string): Promise<IngestSummary> {
  return invoke<IngestSummary>("dev_tools_workspace_run_miners", { workspaceId });
}
/** Write the grounding snapshot into a member repo before dispatching the
 *  practice-harvest Fleet session. Returns the snapshot path + repo root. */
export async function prepareWorkspaceHarvest(
  workspaceId: string,
  projectId: string,
): Promise<HarvestPrepared> {
  return invoke<HarvestPrepared>("dev_tools_workspace_harvest_prepare", { workspaceId, projectId });
}

/** Per-scope harvest coverage for one member repo — which territories have
 *  ever been read, when, and with what yield. Never-harvested scopes sort
 *  first, so the caller can dispatch into unread ground without re-deriving
 *  the order. */
export async function listHarvestCoverage(
  projectId: string,
): Promise<WorkspaceHarvestCoverage[]> {
  return invoke<WorkspaceHarvestCoverage[]>("dev_tools_workspace_harvest_coverage", { projectId });
}

/** Ingest finished harvest run(s) from a member repo into the workspace
 *  library. With no `runDir` EVERY un-ingested run is imported — a scope
 *  fan-out produces one per territory. Items land `observed`, dedup-gated. */
export async function ingestWorkspaceHarvest(
  workspaceId: string,
  projectId: string,
  runDir?: string,
): Promise<IngestSummary> {
  return invoke<IngestSummary>("dev_tools_workspace_knowledge_ingest", {
    workspaceId,
    projectId,
    runDir,
  });
}

// -- divergence pass (Arc 2) -------------------------------------------------

export interface DivergenceStatus {
  job_id: string;
  status: 'running' | 'completed' | 'failed' | 'not_found' | string;
  error?: string | null;
  lines?: string[];
  proposed?: number;
  inserted?: number;
}

/** Start a cross-project divergence pass. Returns the job id; poll with
 *  {@link getDivergenceStatus}. Needs ≥2 member projects and some harvested
 *  knowledge to compare. */
export async function runWorkspaceDivergence(workspaceId: string): Promise<string> {
  return invoke<string>('dev_tools_workspace_run_divergence', { workspaceId });
}

export async function getDivergenceStatus(jobId: string): Promise<DivergenceStatus> {
  return invoke<DivergenceStatus>('dev_tools_workspace_get_divergence_status', { jobId });
}

export async function cancelWorkspaceDivergence(jobId: string): Promise<void> {
  return invoke<void>('dev_tools_workspace_cancel_divergence', { jobId });
}

// -- distribution (Arc 3) ----------------------------------------------------

export type { ProjectionResult };

/** Project the workspace's adopted practices into every member repo as a
 *  Claude Code memory file (`.claude/workspace-practices.md` + one @import
 *  line in CLAUDE.md). Never rewrites the user's own prose. */
export async function projectWorkspacePractices(
  workspaceId: string,
): Promise<ProjectionResult[]> {
  return invoke<ProjectionResult[]>('dev_tools_workspace_project_practices', { workspaceId });
}

// -- adoption verification (Arc 3) -------------------------------------------

export interface VerifyStatus {
  job_id: string;
  status: string;
  error?: string | null;
  lines?: string[];
  checked?: number;
  diverged?: number;
  /** How many practices the run was asked to rule on. */
  selected?: number;
  /** Selected minus checked — verdicts that never landed. A run that lost most
   *  of its work must not read like a clean one. */
  lost?: number;
}

/** Verify that a project's adopted practices still hold in its code. A failed
 *  verdict marks that project's cell `diverged` — it never un-adopts. */
export async function verifyWorkspaceAdoptions(
  workspaceId: string,
  projectId: string,
): Promise<string> {
  return invoke<string>('dev_tools_workspace_verify_adoptions', { workspaceId, projectId });
}

export async function getVerifyStatus(jobId: string): Promise<VerifyStatus> {
  return invoke<VerifyStatus>('dev_tools_workspace_get_verify_status', { jobId });
}
