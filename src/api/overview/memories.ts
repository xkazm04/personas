import { invokeWithTimeout as invoke } from "@/lib/tauriInvoke";

import type { PersonaMemory } from "@/lib/bindings/PersonaMemory";
import type { CreatePersonaMemoryInput } from "@/lib/bindings/CreatePersonaMemoryInput";
import type { MemoryCategoryInfo } from "@/lib/bindings/MemoryCategoryInfo";

// ============================================================================
// Memories
// ============================================================================

// -- Category taxonomy --------------------------------------------------------

export type { MemoryCategoryInfo } from "@/lib/bindings/MemoryCategoryInfo";

/** Fetch the canonical list of memory categories from the backend. */
export const listMemoryCategories = () =>
  invoke<MemoryCategoryInfo[]>("list_memory_categories");

/** Valid importance range: 1 (low) to 5 (critical). */
export const IMPORTANCE_MIN = 1;
export const IMPORTANCE_MAX = 5;

function assertImportance(value: number): void {
  if (!Number.isInteger(value) || value < IMPORTANCE_MIN || value > IMPORTANCE_MAX) {
    throw new Error(`Importance must be an integer between ${IMPORTANCE_MIN} and ${IMPORTANCE_MAX}, got ${value}`);
  }
}

export const listMemories = (
  personaId?: string,
  category?: string,
  search?: string,
  limit?: number,
  offset?: number,
) =>
  invoke<PersonaMemory[]>("list_memories", {
    personaId: personaId,
    category: category,
    search: search,
    limit: limit,
    offset: offset,
  });

export const createMemory = (input: CreatePersonaMemoryInput) => {
  if (input.importance != null) assertImportance(input.importance);
  return invoke<PersonaMemory>("create_memory", { input });
};

export const getMemoryCount = (personaId?: string, category?: string, search?: string) =>
  invoke<number>("get_memory_count", {
    personaId: personaId,
    category: category,
    search: search,
  });

export interface MemoryStats {
  total: number;
  avg_importance: number;
  category_counts: Array<[string, number]>;
  agent_counts: Array<[string, number]>;
}

export const getMemoryStats = (personaId?: string, category?: string, search?: string) =>
  invoke<MemoryStats>("get_memory_stats", {
    personaId: personaId,
    category: category,
    search: search,
  });

export interface MemoriesWithStats {
  memories: PersonaMemory[];
  total: number;
  stats: MemoryStats;
}

export const listMemoriesWithStats = (
  personaId?: string,
  category?: string,
  search?: string,
  limit?: number,
  offset?: number,
  sortColumn?: string,
  sortDirection?: string,
) =>
  invoke<MemoriesWithStats>("list_memories_with_stats", {
    personaId: personaId,
    category: category,
    search: search,
    limit: limit,
    offset: offset,
    sortColumn: sortColumn,
    sortDirection: sortDirection,
  });

export const listMemoriesByExecution = (executionId: string) =>
  invoke<PersonaMemory[]>("list_memories_by_execution", { executionId });

export const deleteMemory = (id: string) =>
  invoke<boolean>("delete_memory", { id });

export const deleteAllMemories = () =>
  invoke<number>("delete_all_memories", {});

/** Atomically create a merged memory and delete the two originals in one SQL transaction. */
export const mergeMemoriesAtomic = (
  input: CreatePersonaMemoryInput,
  deleteIdA: string,
  deleteIdB: string,
) => {
  if (input.importance != null) assertImportance(input.importance);
  return invoke<PersonaMemory>("merge_memories", { input, deleteIdA, deleteIdB });
};

export const updateMemoryImportance = (id: string, importance: number) => {
  assertImportance(importance);
  return invoke<boolean>("update_memory_importance", { id, importance });
};

/**
 * Patch title + content + importance + tags on an existing memory row.
 * Used by the message-rating upsert flow so re-rating the same message
 * updates the existing memory rather than spawning duplicates.
 */
export const updateMemoryContent = (
  id: string,
  title: string,
  content: string,
  importance: number,
  tags: string[] | null,
) => {
  assertImportance(importance);
  return invoke<boolean>("update_memory_content", { id, title, content, importance, tags });
};

export const batchDeleteMemories = (ids: string[]) =>
  invoke<number>("batch_delete_memories", { ids });

export interface MemoryReviewDetail {
  id: string;
  title: string;
  score: number;
  reason: string;
  /**
   * Auto-apply mode actions: 'kept' (importance bumped), 'deleted', 'error'.
   * Proposal mode actions: 'proposed_delete', 'proposed_update_importance' —
   * the live memory rows are untouched until the user explicitly applies.
   */
  action:
    | 'kept'
    | 'deleted'
    | 'error'
    | 'proposed_delete'
    | 'proposed_update_importance';
  error?: string;
}

export interface MemoryReviewResult {
  reviewed: number;
  deleted: number;
  updated: number;
  details: MemoryReviewDetail[];
  /**
   * Set when the call was made in proposal mode (`autoApply: false`).
   * Points at a `persona_memory_review_proposal` row that the user can
   * later apply via `applyPersonaMemoryReviewProposal` or discard via
   * `discardPersonaMemoryReviewProposal`. `null`/`undefined` in
   * auto-apply mode (the legacy direct-mutation path).
   */
  proposal_id?: string;
}

/**
 * Run an LLM-driven relevance review across persona memories.
 *
 * Modes (controlled by `autoApply`):
 * - `true` (default for back-compat): legacy direct-mutation path.
 *   Low-score memories are deleted, high-score memories get an
 *   importance bump.
 * - `false`: proposal mode (mirrors Anthropic Managed Agents'
 *   review-and-discard semantics). No live rows are touched; the
 *   proposed (id, score, action) entries are written to a
 *   `persona_memory_review_proposal` row. Returned `proposal_id`
 *   is the handle the user later applies or discards.
 *
 * `instructions` is optional natural-language steering (≤4096 chars)
 * folded into the LLM prompt.
 */
export const reviewMemoriesWithCli = (
  personaId?: string,
  threshold?: number,
  instructions?: string,
  autoApply?: boolean,
) =>
  invoke<MemoryReviewResult>("review_memories_with_cli", {
    personaId: personaId,
    threshold: threshold,
    instructions: instructions,
    autoApply: autoApply,
  });

// -- Memory Review Proposals (review-and-discard, F4b + F-UI) -----------------

export type { MemoryReviewProposal } from "@/lib/bindings/MemoryReviewProposal";
export type { ProposalEntry } from "@/lib/bindings/ProposalEntry";
import type { MemoryReviewProposal } from "@/lib/bindings/MemoryReviewProposal";
import type { ApplyMemoryReviewProposalResult } from "@/lib/bindings/ApplyMemoryReviewProposalResult";
export type { ApplyMemoryReviewProposalResult } from "@/lib/bindings/ApplyMemoryReviewProposalResult";

/** Apply a pending proposal: execute deletes + importance bumps. */
export const applyPersonaMemoryReviewProposal = (proposalId: string) =>
  invoke<ApplyMemoryReviewProposalResult>("apply_persona_memory_review_proposal", {
    proposalId,
  });

/** Mark a pending proposal as discarded. No DB mutation to memories. */
export const discardPersonaMemoryReviewProposal = (proposalId: string) =>
  invoke<boolean>("discard_persona_memory_review_proposal", { proposalId });

export const listPersonaMemoryReviewProposals = (
  personaId?: string,
  onlyPending?: boolean,
  limit?: number,
) =>
  invoke<MemoryReviewProposal[]>("list_persona_memory_review_proposals", {
    personaId: personaId,
    onlyPending: onlyPending,
    limit: limit,
  });

export const getPersonaMemoryReviewProposal = (proposalId: string) =>
  invoke<MemoryReviewProposal | null>("get_persona_memory_review_proposal", {
    proposalId,
  });

// -- Curation schedule (F-CRON) -----------------------------------------------

export type { PersonaCurationSchedule } from "@/lib/bindings/PersonaCurationSchedule";
import type { PersonaCurationSchedule } from "@/lib/bindings/PersonaCurationSchedule";

/**
 * Set or update the per-persona curation schedule. Pass an empty/whitespace
 * cronExpr to delete the schedule (curation disabled).
 */
export const setPersonaCurationSchedule = (personaId: string, cronExpr: string) =>
  invoke<PersonaCurationSchedule | null>("set_persona_curation_schedule", {
    personaId,
    cronExpr,
  });

export const getPersonaCurationSchedule = (personaId: string) =>
  invoke<PersonaCurationSchedule | null>("get_persona_curation_schedule", {
    personaId,
  });

// -- Memory Tiers -------------------------------------------------------------

export type MemoryTier = "core" | "active" | "working" | "archive";

export const updateMemoryTier = (id: string, tier: MemoryTier) =>
  invoke<boolean>("update_memory_tier", { id, tier });

