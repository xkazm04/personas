import { invokeWithTimeout as invoke } from "@/lib/tauriInvoke";

// ---------------------------------------------------------------------------
// Types (mirrors Rust models — ts-rs will auto-generate these at build time)
// ---------------------------------------------------------------------------

export interface ResearchProject {
  id: string;
  name: string;
  description: string | null;
  domain: string | null;
  status: string;
  thesis: string | null;
  scopeConstraints: string | null;
  teamId: string | null;
  obsidianVaultPath: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface CreateResearchProject {
  name: string;
  description?: string | null;
  domain?: string | null;
  thesis?: string | null;
  scopeConstraints?: string | null;
  teamId?: string | null;
  obsidianVaultPath?: string | null;
}

export interface UpdateResearchProject {
  name?: string | null;
  description?: string | null;
  domain?: string | null;
  status?: string | null;
  thesis?: string | null;
  scopeConstraints?: string | null;
  teamId?: string | null;
  obsidianVaultPath?: string | null;
}

export interface ResearchSource {
  id: string;
  projectId: string;
  sourceType: string;
  title: string;
  authors: string | null;
  year: number | null;
  abstractText: string | null;
  doi: string | null;
  url: string | null;
  pdfPath: string | null;
  citationCount: number | null;
  metadata: string | null;
  relevanceScore: number | null;
  knowledgeBaseId: string | null;
  status: string;
  ingestedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface CreateResearchSource {
  projectId: string;
  sourceType: string;
  title: string;
  authors?: string | null;
  year?: number;
  abstractText?: string | null;
  doi?: string | null;
  url?: string | null;
  metadata?: string | null;
}

export interface ResearchHypothesis {
  id: string;
  projectId: string;
  statement: string;
  rationale: string | null;
  status: string;
  confidence: number;
  parentHypothesisId: string | null;
  generatedBy: string | null;
  supportingEvidence: string | null;
  counterEvidence: string | null;
  linkedExperiments: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface CreateResearchHypothesis {
  projectId: string;
  statement: string;
  rationale?: string | null;
  generatedBy?: string | null;
}

export interface ResearchExperiment {
  id: string;
  projectId: string;
  hypothesisId: string | null;
  name: string;
  methodology: string | null;
  inputSchema: string | null;
  successCriteria: string | null;
  status: string;
  pipelineId: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface CreateResearchExperiment {
  projectId: string;
  hypothesisId?: string | null;
  name: string;
  methodology?: string | null;
  inputSchema?: string | null;
  successCriteria?: string | null;
}

export interface ResearchFinding {
  id: string;
  projectId: string;
  title: string;
  description: string | null;
  confidence: number;
  category: string | null;
  sourceExperimentIds: string | null;
  sourceIds: string | null;
  hypothesisIds: string | null;
  generatedBy: string | null;
  status: string;
  createdAt: string;
  updatedAt: string;
}

export interface CreateResearchFinding {
  projectId: string;
  title: string;
  description?: string | null;
  confidence?: number;
  category?: string | null;
  generatedBy?: string | null;
}

export interface ResearchReport {
  id: string;
  projectId: string;
  title: string;
  reportType: string | null;
  status: string;
  template: string | null;
  format: string | null;
  reviewId: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface CreateResearchReport {
  projectId: string;
  title: string;
  reportType?: string | null;
  format?: string | null;
  template?: string | null;
}

export interface ResearchDashboardStats {
  totalProjects: number;
  activeProjects: number;
  totalSources: number;
  totalHypotheses: number;
  totalExperiments: number;
  totalFindings: number;
  totalReports: number;
}

// ---------------------------------------------------------------------------
// Safe invoke helper
// ---------------------------------------------------------------------------

/**
 * True iff `err` is specifically Tauri's "the IPC command isn't registered"
 * failure — i.e. the backend doesn't implement this research-lab command yet.
 *
 * Historical bug: the previous implementation tested `msg.includes("not found")`,
 * which matched ANY error containing "not found" ("project not found",
 * "source not found", "vault path not found", "host not found"). All of
 * those were silently swallowed as "command missing, return fallback",
 * producing a "0 projects" UI when the backend was genuinely erroring.
 *
 * We now only match on:
 *   1. An AppError-shaped object with `kind === 'not_found'`, or
 *   2. Tauri's canonical `Command "<name>" not found` shape (exact regex).
 *
 * Substring checks on "not found" are never safe — real resource-not-found
 * errors must propagate, not be coerced into an empty list.
 */
const TAURI_COMMAND_NOT_FOUND_RE =
  /^Command [^"]*"[\w_]+"[^"]* not found(?:\.|$)/i;

function isCommandNotFound(err: unknown): boolean {
  if (typeof err === 'object' && err !== null && 'kind' in err) {
    return (err as { kind: string }).kind === 'not_found';
  }
  const msg = typeof err === "string" ? err : err instanceof Error ? err.message
    : typeof err === "object" && err !== null && "error" in err ? String((err as { error: string }).error)
    : String(err);
  return TAURI_COMMAND_NOT_FOUND_RE.test(msg.trim());
}

async function safeInvoke<T>(fallback: T, ...args: Parameters<typeof invoke<T>>): Promise<T> {
  try {
    return await invoke<T>(...args);
  } catch (err) {
    if (isCommandNotFound(err)) return fallback;
    throw err;
  }
}

// ---------------------------------------------------------------------------
// Projects
// ---------------------------------------------------------------------------

export const listProjects = () =>
  safeInvoke<ResearchProject[]>([], "research_lab_list_projects");

export const getProject = (id: string) =>
  invoke<ResearchProject>("research_lab_get_project", { id });

export const createProject = (input: CreateResearchProject) =>
  invoke<ResearchProject>("research_lab_create_project", { input });

export const updateProject = (id: string, input: UpdateResearchProject) =>
  invoke<ResearchProject>("research_lab_update_project", { id, input });

export const deleteProject = (id: string) =>
  invoke<void>("research_lab_delete_project", { id });

// ---------------------------------------------------------------------------
// Sources
// ---------------------------------------------------------------------------

export const listSources = (projectId: string) =>
  safeInvoke<ResearchSource[]>([], "research_lab_list_sources", { projectId });

export const createSource = (input: CreateResearchSource) =>
  invoke<ResearchSource>("research_lab_create_source", { input });

export const deleteSource = (id: string) =>
  invoke<void>("research_lab_delete_source", { id });

// ---------------------------------------------------------------------------
// Hypotheses
// ---------------------------------------------------------------------------

export const listHypotheses = (projectId: string) =>
  safeInvoke<ResearchHypothesis[]>([], "research_lab_list_hypotheses", { projectId });

export const createHypothesis = (input: CreateResearchHypothesis) =>
  invoke<ResearchHypothesis>("research_lab_create_hypothesis", { input });

export const updateHypothesis = (
  id: string,
  status?: string | null,
  confidence?: number | null,
  supportingEvidence?: string | null,
  counterEvidence?: string | null,
) => invoke<void>("research_lab_update_hypothesis", { id, status, confidence, supportingEvidence, counterEvidence });

export const deleteHypothesis = (id: string) =>
  invoke<void>("research_lab_delete_hypothesis", { id });

// ---------------------------------------------------------------------------
// Experiments
// ---------------------------------------------------------------------------

export const listExperiments = (projectId: string) =>
  safeInvoke<ResearchExperiment[]>([], "research_lab_list_experiments", { projectId });

export const createExperiment = (input: CreateResearchExperiment) =>
  invoke<ResearchExperiment>("research_lab_create_experiment", { input });

export const deleteExperiment = (id: string) =>
  invoke<void>("research_lab_delete_experiment", { id });

// ---------------------------------------------------------------------------
// Findings
// ---------------------------------------------------------------------------

export const listFindings = (projectId: string) =>
  safeInvoke<ResearchFinding[]>([], "research_lab_list_findings", { projectId });

export const createFinding = (input: CreateResearchFinding) =>
  invoke<ResearchFinding>("research_lab_create_finding", { input });

export const deleteFinding = (id: string) =>
  invoke<void>("research_lab_delete_finding", { id });

// ---------------------------------------------------------------------------
// Reports
// ---------------------------------------------------------------------------

export const listReports = (projectId: string) =>
  safeInvoke<ResearchReport[]>([], "research_lab_list_reports", { projectId });

export const createReport = (input: CreateResearchReport) =>
  invoke<ResearchReport>("research_lab_create_report", { input });

export const deleteReport = (id: string) =>
  invoke<void>("research_lab_delete_report", { id });

// ---------------------------------------------------------------------------
// Dashboard
// ---------------------------------------------------------------------------

export const getDashboardStats = () =>
  safeInvoke<ResearchDashboardStats>(
    { totalProjects: 0, activeProjects: 0, totalSources: 0, totalHypotheses: 0, totalExperiments: 0, totalFindings: 0, totalReports: 0 },
    "research_lab_get_dashboard_stats",
  );

// ---------------------------------------------------------------------------
// Source ingestion status
// ---------------------------------------------------------------------------

export const updateSourceStatus = (id: string, status: string, knowledgeBaseId?: string | null) =>
  invoke<void>("research_lab_update_source_status", { id, status, knowledgeBaseId });

// ---------------------------------------------------------------------------
// Obsidian sync
// ---------------------------------------------------------------------------

export const syncToObsidian = (projectId: string) =>
  invoke<number>("research_lab_sync_to_obsidian", { projectId });

export const syncDailyNote = (projectId: string) =>
  invoke<string>("research_lab_sync_daily_note", { projectId });

// ---------------------------------------------------------------------------
// Experiment runs
// ---------------------------------------------------------------------------

export interface ResearchExperimentRun {
  id: string;
  experimentId: string;
  runNumber: number;
  inputs: string | null;
  outputs: string | null;
  metrics: string | null;
  passed: number;
  executionId: string | null;
  durationMs: number | null;
  costUsd: number | null;
  createdAt: string;
}

export const listExperimentRuns = (experimentId: string) =>
  safeInvoke<ResearchExperimentRun[]>([], "research_lab_list_experiment_runs", { experimentId });

export const createExperimentRun = (experimentId: string, outputs?: string | null, metrics?: string | null, passed?: boolean) =>
  invoke<ResearchExperimentRun>("research_lab_create_experiment_run", { experimentId, outputs, metrics, passed: passed ?? false });
