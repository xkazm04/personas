/**
 * Overview domain store -- dashboard, messages, events, healing, memories,
 * cron agents, and alerts.
 *
 * Alert rules and history are now persisted in the Rust backend (SQLite).
 * Only ephemeral client-side toast state remains in the Zustand store.
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
import { createPersonaHealthSlice } from "./slices/overview/personaHealthSlice";

export const useOverviewStore = create<OverviewStore>()(
  (...a) => ({
    error: null,
    errorKind: null,
    isLoading: false,
    sliceErrors: {},
    ...createOverviewSlice(...a),
    ...createMessageSlice(...a),
    ...createEventSlice(...a),
    ...createHealingSlice(...a),
    ...createMemorySlice(...a),
    ...createCronAgentsSlice(...a),
    ...createAlertSlice(...a),
    ...createPersonaHealthSlice(...a),
  }),
);
