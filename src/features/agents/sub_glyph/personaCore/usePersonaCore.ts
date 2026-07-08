/** usePersonaCore — the persona-core configuration backbone, rethought against
 *  the real template/recipe/memory data (see docs/features/personas + the three
 *  research passes on 2026-07-08).
 *
 *  What changed and why:
 *   • Model is now TIER × REASONING EFFORT (haiku/sonnet/opus × low/medium/high/
 *     xhigh) — both are first-class, backend-wired knobs. The old "Speed" slider
 *     is gone: as a compute axis it duplicates effort, and its behavioural half
 *     folds into a character trait.
 *   • Character is carried by DISCRETE TRAITS, not sliders — 90% of the 120-persona
 *     corpus expresses personality in prose, not dials. One collapsed "disposition"
 *     slider (risk + speed were near-collinear) plus a clickable trait palette and
 *     a conflict-style temperament. Same model + traits, different conflict style =
 *     genuinely different deliberation.
 *  Memory is intentionally NOT configured here: the build surface has a dedicated
 *  "memory" dimension that owns it, so persona-core neither surfaces memory nor
 *  emits memory directives (that would double-configure and conflict).
 *
 *  Like before, the core doesn't run a bespoke pipeline: it augments the build
 *  intent with a directive block (the honest prototype path). Wiring these to real
 *  persona config — model_profile, --effort — is the next-leverage follow-up.
 */
import { useState, useEffect, useMemo, useCallback } from "react";
import { listArchetypes, type Archetype } from "@/api/archetypes";
import { DEFAULT_EFFORT, type EffortLevel } from "@/lib/models/modelCatalog";
import { silentCatch } from "@/lib/silentCatch";
import { TRAIT_CATALOG, CONFLICT_DIRECTIVE, ARCHETYPE_TRAITS, traitById } from "./coreTraits";

export type ModelTier = "haiku" | "sonnet" | "opus";

export interface PersonaCoreState {
  archetypeId: string | null;
  disposition: number;          // 0 cautious … 1 bold (risk + speed collapsed)
  conflictStyle: string | null; // challenger | analyst | pragmatist | harmonizer
  traits: string[];             // selected trait ids from TRAIT_CATALOG
  model: ModelTier;
  effort: EffortLevel;
}

export const MODEL_TIERS: { id: ModelTier; label: string; blurb: string }[] = [
  { id: "haiku", label: "Haiku", blurb: "Fastest & cheapest — great for high-volume, well-scoped work" },
  { id: "sonnet", label: "Sonnet", blurb: "The everyday default — strong reasoning at moderate cost" },
  { id: "opus", label: "Opus", blurb: "Deepest reasoning for hard, high-stakes work" },
];

export const EFFORT_TIERS: { id: EffortLevel; label: string; blurb: string }[] = [
  { id: "low", label: "Low", blurb: "Minimal deliberation — quickest, cheapest responses" },
  { id: "medium", label: "Medium", blurb: "Balanced reasoning — the default" },
  { id: "high", label: "High", blurb: "Extended reasoning for tricky problems" },
  { id: "xhigh", label: "Max", blurb: "Maximum reasoning depth — slowest, most thorough" },
];

const DEFAULT_CORE: PersonaCoreState = {
  archetypeId: null,
  disposition: 0.4,
  conflictStyle: null,
  traits: [],
  model: "sonnet",
  effort: DEFAULT_EFFORT,
};

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
export function archetypeStance(a: Archetype): string | null {
  return coreString(a, "stance");
}

export interface PersonaCore {
  loading: boolean;
  archetypes: Archetype[];
  state: PersonaCoreState;
  configured: boolean;
  preset: Archetype | null;
  applyPreset: (a: Archetype) => void;
  setDisposition: (v: number) => void;
  setConflict: (id: string | null) => void;
  toggleTrait: (id: string) => void;
  setModel: (m: ModelTier) => void;
  setEffort: (e: EffortLevel) => void;
  reset: () => void;
  launchAugmentation: () => string;
}

export function usePersonaCore(resetKey: string | null): PersonaCore {
  const [loading, setLoading] = useState(true);
  const [archetypes, setArchetypes] = useState<Archetype[]>([]);
  const [state, setState] = useState<PersonaCoreState>(DEFAULT_CORE);
  const [configured, setConfigured] = useState(false);

  useEffect(() => {
    let live = true;
    listArchetypes()
      .then((c) => { if (!live) return; setArchetypes(c.archetypes); setLoading(false); })
      .catch((e) => { silentCatch("personaCore:list_archetypes")(e); if (live) setLoading(false); });
    return () => { live = false; };
  }, []);

  useEffect(() => { setState(DEFAULT_CORE); setConfigured(false); }, [resetKey]);

  const touch = useCallback((fn: (prev: PersonaCoreState) => PersonaCoreState) => {
    setState(fn); setConfigured(true);
  }, []);

  const applyPreset = useCallback((a: Archetype) => {
    touch((prev) => ({
      ...prev,
      archetypeId: a.id,
      disposition: coreNumber(a, "riskTolerance", prev.disposition),
      conflictStyle: coreString(a, "conflictStyle") ?? prev.conflictStyle,
      // Preload the archetype's dominant traits so a snapshot lands as a complete
      // character. A snapshot is a fresh starting point, so this replaces the
      // current trait set (falls back to keeping it only for an unmapped archetype).
      traits: ARCHETYPE_TRAITS[a.id] ?? prev.traits,
    }));
  }, [touch]);

  const setDisposition = useCallback((v: number) => touch((p) => ({ ...p, disposition: v })), [touch]);
  const setConflict = useCallback((id: string | null) => touch((p) => ({ ...p, conflictStyle: p.conflictStyle === id ? null : id })), [touch]);
  const toggleTrait = useCallback((id: string) => touch((p) => ({
    ...p, traits: p.traits.includes(id) ? p.traits.filter((t) => t !== id) : [...p.traits, id],
  })), [touch]);
  const setModel = useCallback((m: ModelTier) => touch((p) => ({ ...p, model: m })), [touch]);
  const setEffort = useCallback((e: EffortLevel) => touch((p) => ({ ...p, effort: e })), [touch]);
  const reset = useCallback(() => { setState(DEFAULT_CORE); setConfigured(false); }, []);

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
    const modelWord = state.model === "haiku" ? "Haiku (fast)" : state.model === "opus" ? "Opus (max reasoning)" : "Sonnet (balanced)";
    lines.push(`Model tier: ${modelWord}; reasoning effort: ${state.effort}`);
    return `\n---\nPersona core:\n${lines.map((l) => `- ${l}`).join("\n")}`;
  }, [configured, state, preset]);

  return {
    loading, archetypes, state, configured, preset,
    applyPreset, setDisposition, setConflict, toggleTrait, setModel, setEffort, reset, launchAugmentation,
  };
}

export const TRAIT_COUNT = TRAIT_CATALOG.length;
