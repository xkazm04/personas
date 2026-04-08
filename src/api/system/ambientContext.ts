import { invokeWithTimeout as invoke } from "@/lib/tauriInvoke";
import type { AmbientContextSnapshot } from "@/lib/bindings/AmbientContextSnapshot";
import type { SensoryPolicy } from "@/lib/bindings/SensoryPolicy";
import type { ContextRule } from "@/lib/bindings/ContextRule";
import type { ContextRuleMatch } from "@/lib/bindings/ContextRuleMatch";
import type { ContextStreamStats } from "@/lib/bindings/ContextStreamStats";
import type { ValidationScreenshot } from "@/lib/bindings/ValidationScreenshot";

export type { AmbientContextSnapshot, SensoryPolicy, ContextRule, ContextRuleMatch, ContextStreamStats, ValidationScreenshot };

// -- Ambient Context Snapshot -----------------------------------------------

export const getAmbientContextSnapshot = (personaId: string) =>
  invoke<AmbientContextSnapshot>("get_ambient_context_snapshot", { personaId });

// -- Global Enable/Disable --------------------------------------------------

export const setAmbientContextEnabled = (enabled: boolean) =>
  invoke<boolean>("set_ambient_context_enabled", { enabled });

export const getAmbientContextEnabled = () =>
  invoke<boolean>("get_ambient_context_enabled", {});

// -- Per-Persona Sensory Policies -------------------------------------------

export const setAmbientSensoryPolicy = (
  personaId: string,
  policy: SensoryPolicy,
) => invoke<void>("set_ambient_sensory_policy", { personaId, policy });

export const getAmbientSensoryPolicy = (personaId: string) =>
  invoke<SensoryPolicy>("get_ambient_sensory_policy", { personaId });

export const removeAmbientSensoryPolicy = (personaId: string) =>
  invoke<void>("remove_ambient_sensory_policy", { personaId });

// -- Context Rules (pattern-based ambient subscriptions) --------------------

export const addContextRule = (rule: ContextRule) =>
  invoke<void>("add_context_rule", { rule });

export const removeContextRule = (ruleId: string) =>
  invoke<boolean>("remove_context_rule", { ruleId });

export const listContextRules = (personaId: string) =>
  invoke<ContextRule[]>("list_context_rules", { personaId });

export const getContextRuleMatches = () =>
  invoke<ContextRuleMatch[]>("get_context_rule_matches", {});

// -- Context Stream Stats ---------------------------------------------------

export const getContextStreamStats = () =>
  invoke<ContextStreamStats>("get_context_stream_stats", {});

// -- Validation Screenshot Capture ------------------------------------------
//
// Opt-in capability for personas that deliver visual output. The agent calls
// this when it wants to screenshot the current state (a target window by
// title, or the primary display) and read the resulting PNG back via its
// multimodal Read path.

export const captureValidationScreenshot = (windowTitle?: string) =>
  invoke<ValidationScreenshot>("capture_validation_screenshot", {
    windowTitle: windowTitle ?? null,
  });
