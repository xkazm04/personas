/** usePersonaCore — the persona-core state backbone (the "what is selected"; the
 *  "what exists" lives in catalog.ts, the types in types.ts).
 *
 *  Rethought 2026-07-08 against the real template/recipe corpus:
 *   • Model = TIER × REASONING EFFORT (haiku/sonnet/opus × low/medium/high/xhigh),
 *     both first-class backend-wired knobs; the old "Speed" slider is gone.
 *   • Character is carried by DISCRETE TRAITS, not sliders — 90% of the 120-persona
 *     corpus expresses personality in prose. One collapsed "disposition" slider
 *     (risk + speed were near-collinear) + a clickable trait palette + a
 *     conflict-style temperament.
 *   • Memory is NOT configured here — the build surface's memory dimension owns it.
 *
 *  The core doesn't run a bespoke pipeline: it augments the build intent with a
 *  directive block (launchAugmentation). Wiring these to real persona config
 *  (model_profile, --effort) is the next-leverage follow-up.
 */
import { useState, useEffect, useMemo, useCallback } from "react";
import { listArchetypes } from "@/api/archetypes";
import { DEFAULT_EFFORT } from "@/lib/models/modelCatalog";
import { silentCatch } from "@/lib/silentCatch";
import { CONFLICT_DIRECTIVE, ARCHETYPE_TRAITS, modelTier, traitById } from "./catalog";
import type { Archetype, EffortLevel, ModelTier, PersonaCore, PersonaCoreState } from "./types";

const DEFAULT_CORE: PersonaCoreState = {
  archetypeId: null,
  disposition: 0.4,
  conflictStyle: null,
  traits: [],
  model: "sonnet",
  effort: DEFAULT_EFFORT,
};

/** Is this state still the untouched default? `configured` is DERIVED from
 *  this rather than latched by a "the user clicked something" flag: the flag
 *  never went back down, so undoing every choice (toggling the last trait off,
 *  deselecting a conflict style) left the badge reading "Custom core" and the
 *  launch augmentation still injecting a default disposition + model line the
 *  user had explicitly cleared. */
function isDefaultCore(s: PersonaCoreState): boolean {
  return (
    s.archetypeId === DEFAULT_CORE.archetypeId &&
    s.disposition === DEFAULT_CORE.disposition &&
    s.conflictStyle === DEFAULT_CORE.conflictStyle &&
    s.model === DEFAULT_CORE.model &&
    s.effort === DEFAULT_CORE.effort &&
    s.traits.length === 0
  );
}

function coreNumber(a: Archetype, key: string, fallback: number): number {
  const core = (a.persona as { core?: Record<string, unknown> } | undefined)?.core;
  const v = core?.[key];
  return typeof v === "number" ? v : fallback;
}
function coreString(a: Archetype, key: string): string | null {
  const core = (a.persona as { core?: Record<string, unknown> } | undefined)?.core;
  const v = core?.[key];
  return typeof v === "string" ? v : null;
}
function archetypeStance(a: Archetype): string | null {
  return coreString(a, "stance");
}

export function usePersonaCore(resetKey: string | null): PersonaCore {
  const [loading, setLoading] = useState(true);
  const [archetypes, setArchetypes] = useState<Archetype[]>([]);
  // A failed catalog fetch must NOT be spelled the same way as an empty
  // catalog: both used to leave `archetypes: []` behind, and the Mentality
  // column rendered a silent blank with no explanation and no way back.
  const [loadFailed, setLoadFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [state, setState] = useState<PersonaCoreState>(DEFAULT_CORE);
  const configured = useMemo(() => !isDefaultCore(state), [state]);

  useEffect(() => {
    let live = true;
    setLoading(true);
    setLoadFailed(false);
    listArchetypes()
      .then((c) => { if (!live) return; setArchetypes(c.archetypes); setLoading(false); })
      .catch((e) => {
        silentCatch("personaCore:list_archetypes")(e);
        if (!live) return;
        setLoadFailed(true);
        setLoading(false);
      });
    return () => { live = false; };
  }, [attempt]);

  const retryLoad = useCallback(() => setAttempt((n) => n + 1), []);

  // Reset only when the surface returns to COMPOSE (`resetKey` null). The key
  // is the build-session id, which goes null -> <id> at LAUNCH: resetting there
  // wiped the core the build had just been launched with, so the (locked,
  // view-only) badge read "Persona core / unconfigured" for the whole build
  // while the intent it shipped carried the core's directives.
  useEffect(() => {
    if (resetKey !== null) return;
    setState(DEFAULT_CORE);
  }, [resetKey]);

  const applyPreset = useCallback((a: Archetype) => {
    setState((prev) => ({
      ...prev,
      archetypeId: a.id,
      disposition: coreNumber(a, "riskTolerance", prev.disposition),
      conflictStyle: coreString(a, "conflictStyle") ?? prev.conflictStyle,
      // Preload the archetype's dominant traits so a snapshot lands as a complete
      // character. A snapshot is a fresh starting point, so this replaces the
      // current trait set (falls back to keeping it only for an unmapped archetype).
      traits: ARCHETYPE_TRAITS[a.id] ?? prev.traits,
    }));
  }, []);

  const setDisposition = useCallback((v: number) => setState((p) => ({ ...p, disposition: v })), []);
  const setConflict = useCallback((id: string | null) => setState((p) => ({ ...p, conflictStyle: p.conflictStyle === id ? null : id })), []);
  const toggleTrait = useCallback((id: string) => setState((p) => ({
    ...p, traits: p.traits.includes(id) ? p.traits.filter((t) => t !== id) : [...p.traits, id],
  })), []);
  const setModel = useCallback((m: ModelTier) => setState((p) => ({ ...p, model: m })), []);
  const setEffort = useCallback((e: EffortLevel) => setState((p) => ({ ...p, effort: e })), []);
  const reset = useCallback(() => setState(DEFAULT_CORE), []);

  const preset = useMemo(() => archetypes.find((a) => a.id === state.archetypeId) ?? null, [archetypes, state.archetypeId]);

  const launchAugmentation = useCallback(() => {
    if (!configured) return "";
    const lines: string[] = [];
    if (preset) lines.push(`Mentality: ${preset.name}${archetypeStance(preset) ? ` — ${archetypeStance(preset)}` : ""}`);
    lines.push(
      state.disposition < 0.34 ? "Disposition: cautious — verify before acting, escalate on ambiguity"
        : state.disposition > 0.66 ? "Disposition: bold — act decisively, tolerate reversible mistakes"
        : "Disposition: balanced — act on clear cases, check the rest",
    );
    if (state.conflictStyle && CONFLICT_DIRECTIVE[state.conflictStyle]) lines.push(CONFLICT_DIRECTIVE[state.conflictStyle]!);
    for (const id of state.traits) { const t = traitById(id); if (t) lines.push(t.directive); }
    // The prompt word comes off MODEL_TIERS, not a ternary: the same three
    // tiers used to be spelled out here, in ConfigTiles' icon map and in the
    // catalog, so a fourth tier had to be added in three places and only one
    // of them was under test.
    lines.push(`Model tier: ${modelTier(state.model).promptWord}; reasoning effort: ${state.effort}`);
    return `\n---\nPersona core:\n${lines.map((l) => `- ${l}`).join("\n")}`;
  }, [configured, state, preset]);

  return {
    loading, archetypes, loadFailed, retryLoad, state, configured, preset,
    applyPreset, setDisposition, setConflict, toggleTrait, setModel, setEffort, reset, launchAugmentation,
  };
}
