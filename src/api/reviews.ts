import { invoke } from "@tauri-apps/api/core";

import type { PersonaDesignReview } from "@/lib/bindings/PersonaDesignReview";
import type { PersonaManualReview } from "@/lib/bindings/PersonaManualReview";
import type { Persona } from "@/lib/bindings/Persona";

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
  test_run_id: string;
  reviewed_at: string;
}) => invoke<PersonaDesignReview>("import_design_review", { input });

export const adoptDesignReview = (reviewId: string) =>
  invoke<{ persona: Persona }>("adopt_design_review", { reviewId });

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
