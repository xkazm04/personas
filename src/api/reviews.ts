import { invoke } from "@tauri-apps/api/core";

import type { PersonaDesignReview } from "@/lib/bindings/PersonaDesignReview";
import type { PersonaManualReview } from "@/lib/bindings/PersonaManualReview";

// ============================================================================
// Design Reviews
// ============================================================================

export const listDesignReviews = (testRunId?: string, limit?: number) =>
  invoke<PersonaDesignReview[]>("list_design_reviews", {
    testRunId: testRunId ?? null,
    limit: limit ?? null,
  });

export const getDesignReview = (id: string) =>
  invoke<PersonaDesignReview>("get_design_review", { id });

export const deleteDesignReview = (id: string) =>
  invoke<boolean>("delete_design_review", { id });

export const startDesignReviewRun = (personaId: string, testCases: object[]) =>
  invoke<{ run_id: string; total: number }>("start_design_review_run", {
    personaId,
    testCases,
  });

export const cancelDesignReviewRun = (runId: string) =>
  invoke<void>("cancel_design_review_run", { runId });

export const rebuildDesignReview = (id: string, userInstruction?: string) =>
  invoke<{ rebuild_id: string }>("rebuild_design_review", {
    id,
    userInstruction: userInstruction ?? null,
  });

export const getRebuildSnapshot = (rebuildId: string) =>
  invoke<{
    transform_id: string;
    status: 'idle' | 'running' | 'completed' | 'failed';
    error: string | null;
    lines: string[];
    draft: unknown | null;
    questions: unknown | null;
  }>("get_rebuild_snapshot", { rebuildId });

export const cancelRebuild = (rebuildId: string) =>
  invoke<void>("cancel_rebuild", { rebuildId });

// ============================================================================
// Paginated Design Reviews
// ============================================================================

export interface PaginatedReviewsResult {
  items: PersonaDesignReview[];
  total: number;
}

export interface ReviewQueryParams {
  search?: string;
  connectorFilter?: string[];
  sortBy?: string;
  sortDir?: string;
  page?: number;
  perPage?: number;
}

export const listDesignReviewsPaginated = (params: ReviewQueryParams) =>
  invoke<PaginatedReviewsResult>("list_design_reviews_paginated", {
    search: params.search ?? null,
    connectorFilter: params.connectorFilter ?? null,
    sortBy: params.sortBy ?? null,
    sortDir: params.sortDir ?? null,
    page: params.page ?? 0,
    perPage: params.perPage ?? 10,
  });

export interface ConnectorWithCount {
  name: string;
  count: number;
}

export const listReviewConnectors = () =>
  invoke<ConnectorWithCount[]>("list_review_connectors");

export const cleanupDuplicateReviews = () =>
  invoke<{ deleted: number }>("cleanup_duplicate_reviews");

// ============================================================================
// Import
// ============================================================================

export const importDesignReview = (input: {
  test_case_id: string;
  test_case_name: string;
  instruction: string;
  status: string;
  structural_score: number | null;
  semantic_score: number | null;
  connectors_used: string | null;
  trigger_types: string | null;
  design_result: string | null;
  use_case_flows?: string | null;
  test_run_id: string;
  reviewed_at: string;
}) => invoke<PersonaDesignReview>("import_design_review", { input });

// ============================================================================
// Manual Reviews
// ============================================================================

export const listManualReviews = (personaId?: string, status?: string) =>
  invoke<PersonaManualReview[]>("list_manual_reviews", {
    personaId: personaId ?? null,
    status: status ?? null,
  });

export const updateManualReviewStatus = (
  id: string,
  status: string,
  reviewerNotes?: string,
) =>
  invoke<PersonaManualReview>("update_manual_review_status", {
    id,
    status,
    reviewerNotes: reviewerNotes ?? null,
  });

export const getPendingReviewCount = (personaId?: string) =>
  invoke<number>("get_pending_review_count", {
    personaId: personaId ?? null,
  });
