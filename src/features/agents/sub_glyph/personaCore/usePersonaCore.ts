/** usePersonaCore — the persona-core configuration backbone, consolidated from
 *  the retired Persona Foundry ("Compose") page.
 *
 *  The Foundry made "foundation" a whole page step: pick a mentality archetype +
 *  a memory strategy. That idea is good; a full page for it was not. Here it
 *  becomes one badge under the intent that opens a configurator modal. The core
 *  is four knobs — Risk, Speed, Model, Memory — that an archetype PRESET fills in
 *  one click and the user can then hand-tune. Archetypes carry riskTolerance +
 *  speedVsQuality in their `persona.core`; memory strategies come from the same
 *  catalog; the model tier is Haiku/Sonnet/Opus.
 *
 *  The core doesn't run a bespoke create pipeline (the Foundry did). It augments
 *  the Dialogue+Cinema launch intent with a compact directive block so the normal
 *  build-from-intent path honours the chosen temperament — the same mechanism the
 *  memory/review toggles already use.
 */
import { useState, useEffect, useMemo, useCallback } from "react";
import { listArchetypes, type Archetype, type MemoryStrategy } from "@/api/archetypes";
import { silentCatch } from "@/lib/silentCatch";

export type ModelTier = "haiku" | "sonnet" | "opus";

/** The four tunable knobs plus the preset they were seeded from. */
export interface PersonaCoreState {
  /** Archetype preset the knobs were last seeded from (null = fully manual). */
  archetypeId: string | null;
  risk: number;   // 0 (cautious) … 1 (bold) — maps to core.riskTolerance
  speed: number;  // 0 (quality) … 1 (speed) — maps to core.speedVsQuality
  model: ModelTier;
  memoryId: string | null;
}

export const MODEL_TIERS: { id: ModelTier; label: string; blurb: string }[] = [
  { id: "haiku", label: "Fast", blurb: "Haiku — quickest, cheapest, great for high-volume simple work" },
  { id: "sonnet", label: "Balanced", blurb: "Sonnet — the everyday default; strong reasoning at moderate cost" },
  { id: "opus", label: "Max", blurb: "Opus — deepest reasoning for hard, high-stakes work" },
];

const DEFAULT_CORE: PersonaCoreState = {
  archetypeId: null,
  risk: 0.4,
  speed: 0.5,
  model: "sonnet",
  memoryId: null,
};

/** Read a numeric knob out of an archetype's opaque `persona.core` payload. */
function coreNumber(a: Archetype, key: string, fallback: number): number {
  const core = (a.persona as { core?: Record<string, unknown> } | undefined)?.core;
  const v = core?.[key];
  return typeof v === "number" ? v : fallback;
}

/** Short human stance line for a preset card, if the archetype declares one. */
export function archetypeStance(a: Archetype): string | null {
  const core = (a.persona as { core?: Record<string, unknown> } | undefined)?.core;
  const v = core?.["stance"];
  return typeof v === "string" ? v : null;
}

export interface PersonaCore {
  loading: boolean;
  archetypes: Archetype[];
  memoryStrategies: MemoryStrategy[];
  state: PersonaCoreState;
  /** Whether the user has touched the core at all (drives the badge's active look). */
  configured: boolean;
  /** The archetype object matching state.archetypeId, if any. */
  preset: Archetype | null;
  /** The memory strategy object matching state.memoryId, if any. */
  memory: MemoryStrategy | null;
  /** Seed all four knobs from an archetype preset (keeps an explicit memory pick). */
  applyPreset: (a: Archetype) => void;
  setRisk: (v: number) => void;
  setSpeed: (v: number) => void;
  setModel: (m: ModelTier) => void;
  setMemory: (id: string | null) => void;
  reset: () => void;
  /** The directive block appended to the launch intent (empty when untouched). */
  launchAugmentation: () => string;
}

export function usePersonaCore(resetKey: string | null): PersonaCore {
  const [loading, setLoading] = useState(true);
  const [archetypes, setArchetypes] = useState<Archetype[]>([]);
  const [memoryStrategies, setMemoryStrategies] = useState<MemoryStrategy[]>([]);
  const [state, setState] = useState<PersonaCoreState>(DEFAULT_CORE);
  const [configured, setConfigured] = useState(false);

  useEffect(() => {
    let live = true;
    listArchetypes()
      .then((c) => {
        if (!live) return;
        setArchetypes(c.archetypes);
        setMemoryStrategies(c.memoryStrategies);
        setLoading(false);
      })
      .catch((e) => { silentCatch("personaCore:list_archetypes")(e); if (live) setLoading(false); });
    return () => { live = false; };
  }, []);

  // A new build session wipes the core back to untouched defaults.
  useEffect(() => {
    setState(DEFAULT_CORE);
    setConfigured(false);
  }, [resetKey]);

  const applyPreset = useCallback((a: Archetype) => {
    setState((prev) => ({
      archetypeId: a.id,
      risk: coreNumber(a, "riskTolerance", prev.risk),
      speed: coreNumber(a, "speedVsQuality", prev.speed),
      model: prev.model,
      memoryId: prev.memoryId,
    }));
    setConfigured(true);
  }, []);

  // Hand-tuning a knob detaches from the preset label only if the value diverges;
  // we keep the preset id so the UI can still show "based on <preset>".
  const setRisk = useCallback((v: number) => { setState((p) => ({ ...p, risk: v })); setConfigured(true); }, []);
  const setSpeed = useCallback((v: number) => { setState((p) => ({ ...p, speed: v })); setConfigured(true); }, []);
  const setModel = useCallback((m: ModelTier) => { setState((p) => ({ ...p, model: m })); setConfigured(true); }, []);
  const setMemory = useCallback((id: string | null) => { setState((p) => ({ ...p, memoryId: id })); setConfigured(true); }, []);
  const reset = useCallback(() => { setState(DEFAULT_CORE); setConfigured(false); }, []);

  const preset = useMemo(
    () => archetypes.find((a) => a.id === state.archetypeId) ?? null,
    [archetypes, state.archetypeId],
  );
  const memory = useMemo(
    () => memoryStrategies.find((m) => m.id === state.memoryId) ?? null,
    [memoryStrategies, state.memoryId],
  );

  const launchAugmentation = useCallback(() => {
    if (!configured) return "";
    const riskWord = state.risk < 0.34 ? "cautious — verify before acting, escalate on ambiguity"
      : state.risk > 0.66 ? "bold — act decisively, tolerate reversible mistakes"
      : "balanced — act on clear cases, check the rest";
    const speedWord = state.speed < 0.34 ? "favour thoroughness over speed"
      : state.speed > 0.66 ? "favour speed and momentum over exhaustive checks"
      : "balance speed and thoroughness";
    const modelWord = state.model === "haiku" ? "Haiku (fast)" : state.model === "opus" ? "Opus (max reasoning)" : "Sonnet (balanced)";
    const lines = [
      preset ? `Mentality: ${preset.name}${archetypeStance(preset) ? ` — ${archetypeStance(preset)}` : ""}` : null,
      `Risk posture: ${riskWord}`,
      `Working style: ${speedWord}`,
      `Preferred model tier: ${modelWord}`,
      memory ? `Memory: ${memory.name} — ${memory.whatItRemembers}` : null,
    ].filter(Boolean);
    return `\n---\nPersona core:\n${lines.map((l) => `- ${l}`).join("\n")}`;
  }, [configured, state, preset, memory]);

  return {
    loading, archetypes, memoryStrategies, state, configured, preset, memory,
    applyPreset, setRisk, setSpeed, setModel, setMemory, reset, launchAugmentation,
  };
}
