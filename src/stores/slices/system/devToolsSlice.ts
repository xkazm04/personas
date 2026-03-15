import type { StateCreator } from "zustand";
import type { SystemStore } from "../../storeTypes";

// Re-export sub-slice interfaces and creators
export { type DevToolsProjectSlice, createDevToolsProjectSlice } from "./devToolsProjectSlice";
export { type DevToolsContextSlice, createDevToolsContextSlice } from "./devToolsContextSlice";
export { type DevToolsScannerSlice, createDevToolsScannerSlice } from "./devToolsScannerSlice";
export { type DevToolsTriageSlice, createDevToolsTriageSlice } from "./devToolsTriageSlice";
export { type DevToolsTaskSlice, createDevToolsTaskSlice } from "./devToolsTaskSlice";

import type { DevToolsProjectSlice } from "./devToolsProjectSlice";
import type { DevToolsContextSlice } from "./devToolsContextSlice";
import type { DevToolsScannerSlice } from "./devToolsScannerSlice";
import type { DevToolsTriageSlice } from "./devToolsTriageSlice";
import type { DevToolsTaskSlice } from "./devToolsTaskSlice";

import { createDevToolsProjectSlice } from "./devToolsProjectSlice";
import { createDevToolsContextSlice } from "./devToolsContextSlice";
import { createDevToolsScannerSlice } from "./devToolsScannerSlice";
import { createDevToolsTriageSlice } from "./devToolsTriageSlice";
import { createDevToolsTaskSlice } from "./devToolsTaskSlice";

/** Combined DevTools slice — intersection of all sub-slices. */
export type DevToolsSlice =
  DevToolsProjectSlice &
  DevToolsContextSlice &
  DevToolsScannerSlice &
  DevToolsTriageSlice &
  DevToolsTaskSlice;

/** Merged creator that composes all DevTools sub-slice creators. */
export const createDevToolsSlice: StateCreator<SystemStore, [], [], DevToolsSlice> = (...args) => ({
  ...createDevToolsProjectSlice(...args),
  ...createDevToolsContextSlice(...args),
  ...createDevToolsScannerSlice(...args),
  ...createDevToolsTriageSlice(...args),
  ...createDevToolsTaskSlice(...args),
});
