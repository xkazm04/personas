/**
 * Pipeline domain store -- triggers, teams, recipes, and assignments.
 */
import { create } from "zustand";
import type { PipelineStore } from "./storeTypes";

import { createTriggerSlice } from "./slices/pipeline/triggerSlice";
import { createTeamSlice } from "./slices/pipeline/teamSlice";
import { createRecipeSlice } from "./slices/pipeline/recipeSlice";
import { createAssignmentSlice } from "./slices/pipeline/assignmentSlice";

export const usePipelineStore = create<PipelineStore>()((...a) => ({
  error: null,
  errorKind: null,
  isLoading: false,
  sliceErrors: {},
  ...createTriggerSlice(...a),
  ...createTeamSlice(...a),
  ...createRecipeSlice(...a),
  ...createAssignmentSlice(...a),
}));
