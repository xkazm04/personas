/** SnapshotColumn — the mentality presets as a vertical list of rich MentalityCards
 *  (avatar + name + tagline + signature trait strip). Picking one seeds disposition
 *  + conflict + dominant traits (applyPreset). */
import { MentalityCard } from "./MentalityCard";
import type { PersonaCore } from "./types";

export function SnapshotColumn({ core }: { core: PersonaCore }) {
  return (
    <div className="flex flex-col gap-2">
      {core.archetypes.map((a) => (
        <MentalityCard
          key={a.id}
          archetype={a}
          active={core.state.archetypeId === a.id}
          onSelect={() => core.applyPreset(a)}
        />
      ))}
    </div>
  );
}
