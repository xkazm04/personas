/**
 * Pipeline domain store -- triggers, teams, groups, and recipes.
 */
import { create } from "zustand";
import type { PipelineStore } from "./storeTypes";

import { createTriggerSlice } from "./slices/pipeline/triggerSlice";
import { createTeamSlice } from "./slices/pipeline/teamSlice";
import { createGroupSlice } from "./slices/pipeline/groupSlice";
import { createRecipeSlice } from "./slices/pipeline/recipeSlice";
import { createCompositionSlice } from "./slices/pipeline/compositionSlice";

export const usePipelineStore = create<PipelineStore>()((...a) => ({
  error: null,
  errorKind: null,
  isLoading: false,
  ...createTriggerSlice(...a),
  ...createTeamSlice(...a),
  ...createGroupSlice(...a),
  ...createRecipeSlice(...a),
  ...createCompositionSlice(...a),
}));
