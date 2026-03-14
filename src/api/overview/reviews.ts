import { invokeWithTimeout as invoke } from "@/lib/tauriInvoke";

import type { ManualReviewStatus } from "@/lib/bindings/ManualReviewStatus";
import type { PersonaDesignReview } from "@/lib/bindings/PersonaDesignReview";
import type { PersonaManualReview } from "@/lib/bindings/PersonaManualReview";
import type { ReviewMessage } from "@/lib/bindings/ReviewMessage";

// ============================================================================
// Design Reviews
// ============================================================================

export const listDesignReviews = (testRunId?: string, limit?: number) =>
  invoke<PersonaDesignReview[]>("list_design_reviews", {
    testRunId: testRunId,
    limit: limit,
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
    userInstruction: userInstruction,
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
  categoryFilter?: string[];
  sortBy?: string;
  sortDir?: string;
  page?: number;
  perPage?: number;
  coverageFilter?: string;
  coverageServiceTypes?: string[];
}

export const listDesignReviewsPaginated = (params: ReviewQueryParams) =>
  invoke<PaginatedReviewsResult>("list_design_reviews_paginated", {
    search: params.search,
    connectorFilter: params.connectorFilter,
    categoryFilter: params.categoryFilter,
    sortBy: params.sortBy,
    sortDir: params.sortDir,
    page: params.page ?? 0,
    perPage: params.perPage ?? 10,
    coverageFilter: params.coverageFilter,
    coverageServiceTypes: params.coverageServiceTypes,
  });

export interface ConnectorWithCount {
  name: string;
  count: number;
}

export const listReviewConnectors = () =>
  invoke<ConnectorWithCount[]>("list_review_connectors");

export interface CategoryWithCount {
  name: string;
  count: number;
}

export const listReviewCategories = () =>
  invoke<CategoryWithCount[]>("list_review_categories");

export const cleanupDuplicateReviews = () =>
  invoke<{ deleted: number }>("cleanup_duplicate_reviews");

export const backfillReviewCategories = () =>
  invoke<{ total: number; updated: number }>("backfill_review_categories");

export const backfillServiceFlow = () =>
  invoke<{ total: number; updated: number; skipped: number }>("backfill_service_flow");

export const backfillRelatedTools = () =>
  invoke<{ total: number; updated: number; skipped: number }>("backfill_related_tools");

export const getTrendingTemplates = (limit?: number) =>
  invoke<PersonaDesignReview[]>("get_trending_templates", {
    limit: limit,
  });

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
  category?: string | null;
}) => invoke<PersonaDesignReview>("import_design_review", { input });

// ============================================================================
// Manual Reviews
// ============================================================================

export const listManualReviews = (personaId?: string, status?: string) =>
  invoke<PersonaManualReview[]>("list_manual_reviews", {
    personaId: personaId,
    status: status,
  });

export const updateManualReviewStatus = (
  id: string,
  status: ManualReviewStatus,
  reviewerNotes?: string,
) =>
  invoke<PersonaManualReview>("update_manual_review_status", {
    id,
    status,
    reviewerNotes: reviewerNotes,
  });

export const getPendingReviewCount = (personaId?: string) =>
  invoke<number>("get_pending_review_count", {
    personaId: personaId,
  });

// ============================================================================
// Review Messages (Conversational Thread)
// ============================================================================

export const listReviewMessages = (reviewId: string) =>
  invoke<ReviewMessage[]>("list_review_messages", { reviewId });

export const addReviewMessage = (
  reviewId: string,
  role: string,
  content: string,
  metadata?: string,
) =>
  invoke<ReviewMessage>("add_review_message", {
    reviewId,
    role,
    content,
    metadata: metadata,
  });

export const seedMockManualReview = () =>
  invoke<PersonaManualReview>("seed_mock_manual_review", {});
