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
  // `disposition` (a 0…1 cautious-to-bold slider) was removed with the
  // agent-manifest rebase: its only two consumers were the runtime Core's
  // numeric risk/speed dials, which the prompt no longer renders, and a
  // three-band prose line generated FROM the number, which is exactly the
  // "calibrated pseudo-prose" Stage B deleted on the Rust side.
  conflictStyle: string | null; // challenger | analyst | pragmatist | harmonizer
  traits: string[];             // selected trait ids from TRAIT_CATALOG
  model: ModelTier;
  effort: EffortLevel;
}

export interface PersonaCore {
  loading: boolean;
  archetypes: Archetype[];
  /** The archetype catalog fetch FAILED — distinct from "it returned nothing",
   *  so the surface can state the failure instead of painting an empty column. */
  loadFailed: boolean;
  /** Re-run the archetype catalog fetch (the cure offered beside `loadFailed`). */
  retryLoad: () => void;
  state: PersonaCoreState;
  configured: boolean;
  preset: Archetype | null;
  applyPreset: (a: Archetype) => void;
  /** The hand-picked trait set the last `applyPreset` REPLACED, or null when
   *  there is nothing to give back. A mentality card is one click away from the
   *  trait grid in the same modal and replaces the whole set with no warning,
   *  so the work a user spent a minute on can vanish to an idle click. This is
   *  the way back — see `restoreTraits`. */
  discardedTraits: string[] | null;
  /** Put the discarded trait set back, keeping the archetype the user just
   *  picked. Null-safe: a no-op when nothing was discarded. */
  restoreTraits: () => void;
  setConflict: (id: string | null) => void;
  toggleTrait: (id: string) => void;
  setModel: (m: ModelTier) => void;
  setEffort: (e: EffortLevel) => void;
  reset: () => void;
  launchAugmentation: () => string;
}
