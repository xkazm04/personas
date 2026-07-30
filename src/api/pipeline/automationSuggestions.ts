/**
 * Self-Wiring Fabric v1 — API wrappers for mined automation suggestions.
 *
 * `accept` here only STAMPS the decision (the mined-route tag); the trigger
 * itself is created by the Studio through the existing commit path
 * (`createTrigger` → `dryRunTrigger` → `updateTrigger`) — see
 * `sub_studio/suggestions/useAutomationSuggestions.ts`.
 */
import { invokeWithTimeout as invoke } from "@/lib/tauriInvoke";

import type { AutomationSuggestion } from "@/lib/bindings/AutomationSuggestion";
import type { AutomationSuggestionFeed } from "@/lib/bindings/AutomationSuggestionFeed";

export const listAutomationSuggestions = () =>
  invoke<AutomationSuggestionFeed>("list_automation_suggestions");

export const acceptAutomationSuggestion = (id: string, triggerId: string) =>
  invoke<AutomationSuggestion>("accept_automation_suggestion", { id, triggerId });

export const rejectAutomationSuggestion = (id: string) =>
  invoke<AutomationSuggestion>("reject_automation_suggestion", { id });
