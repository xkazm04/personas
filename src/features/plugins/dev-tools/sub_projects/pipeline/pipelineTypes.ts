/**
 * Shared types for the Dev Tools project pipeline-stepper.
 *
 * The project onboarding modal and the Overview view-mode render the same
 * conceptual pipeline (a horizontal rail of SDLC stages, each stage's config
 * shown below its node). This file holds the vocabulary both surfaces share.
 *
 * Phase 1 ships two stages (Project, Source control); the design is built to
 * grow — adding a stage is a new `PipelineStage` entry + an editor/summary
 * component, with no change to `PipelineRail`.
 */
import type { LucideIcon } from 'lucide-react';

/**
 * Source-control binding mode (stage 2). Mutually exclusive at the data layer:
 * `team` sets `team_id` and clears `pr_credential_id`; `standalone` does the
 * reverse. Repo + branches + test-env fields are common to both.
 */
export type SourceMode = 'team' | 'standalone';

/**
 * Editable field ids the Overview's read-only pipeline exposes to its
 * quick-edit popover. Each id maps to one KvRow; the orchestrator
 * ({@link EditableProjectPipeline}) builds the matching editor + save call.
 */
export type PipelineFieldId =
  | 'name'
  | 'source-team'
  | 'source-cred'
  | 'github-url'
  | 'main-branch'
  | 'test-env'
  | 'std-precommit'
  | 'std-pr-base'
  | 'std-automerge';

/** A stage's progress state, used to tint its rail node. */
export type StageStatus = 'complete' | 'active' | 'incomplete';

/** One node on the horizontal pipeline rail. */
export interface PipelineStage {
  id: string;
  label: string;
  icon: LucideIcon;
  status: StageStatus;
}
