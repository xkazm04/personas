/**
 * Overview domain store -- dashboard, messages, events, healing, memories,
 * cron agents, and alerts.
 */
import { create } from "zustand";
import type { OverviewStore } from "./storeTypes";

import { createOverviewSlice } from "./slices/overview/overviewSlice";
import { createMessageSlice } from "./slices/overview/messageSlice";
import { createEventSlice } from "./slices/overview/eventSlice";
import { createHealingSlice } from "./slices/overview/healingSlice";
import { createMemorySlice } from "./slices/overview/memorySlice";
import { createCronAgentsSlice } from "./slices/overview/cronAgentsSlice";
import { createAlertSlice } from "./slices/overview/alertSlice";

export const useOverviewStore = create<OverviewStore>()((...a) => ({
  error: null,
  isLoading: false,
  ...createOverviewSlice(...a),
  ...createMessageSlice(...a),
  ...createEventSlice(...a),
  ...createHealingSlice(...a),
  ...createMemorySlice(...a),
  ...createCronAgentsSlice(...a),
  ...createAlertSlice(...a),
}));
