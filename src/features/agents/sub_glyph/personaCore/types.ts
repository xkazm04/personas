/** types — the persona-core domain types, centralized.
 *
 *  `PersonaCore` is the hook's public contract (state + setters + launchAugmentation);
 *  `PersonaCoreState` is the serialisable configuration; the trait/axis types back
 *  the catalog. Data lives in catalog.ts, the live state in usePersonaCore.ts.
 */
import type { Archetype } from "@/api/archetypes";
import type { EffortLevel } from "@/lib/models/modelCatalog";
import type { LucideIcon } from "lucide-react";

export type { Archetype, EffortLevel };

export type ModelTier = "haiku" | "sonnet" | "opus";
export type TraitAxis = "rigor" | "autonomy" | "communication" | "reliability" | "temperament";

export interface CharacterTrait {
  id: string;
  label: string;
  axis: TraitAxis;
  blurb: string;
  /** How many of the 120 corpus personas embody it — drives ordering within an axis. */
  count: number;
  icon: LucideIcon;
  /** Directive line injected into the build intent when the trait is chosen. */
  directive: string;
}

export interface PersonaCoreState {
  archetypeId: string | null;
  disposition: number;          // 0 cautious … 1 bold (risk + speed collapsed)
  conflictStyle: string | null; // challenger | analyst | pragmatist | harmonizer
  traits: string[];             // selected trait ids from TRAIT_CATALOG
  model: ModelTier;
  effort: EffortLevel;
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
