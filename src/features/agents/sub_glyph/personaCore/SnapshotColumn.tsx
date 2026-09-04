/** SnapshotColumn — the mentality presets as a vertical list of rich MentalityCards
 *  (avatar + name + tagline + signature trait strip). Picking one seeds the
 *  conflict style + dominant traits (applyPreset). */
import { RefreshCw } from "lucide-react";
import { useTranslation } from "@/i18n/useTranslation";
import { MentalityCard } from "./MentalityCard";
import type { PersonaCore } from "./types";

export function SnapshotColumn({ core }: { core: PersonaCore }) {
  const { t } = useTranslation();

  // A failed catalog fetch is NOT an empty catalog. Before this branch existed
  // both landed as `archetypes: []` and the column rendered as blank space
  // under its header — the user saw a section that looked deliberately empty
  // and had no way to retry.
  if (core.loadFailed) {
    return (
      <div
        className="flex flex-col items-start gap-2 rounded-card border border-card-border bg-secondary/20 p-4"
        data-testid="core-snapshot-load-failed"
      >
        <span className="typo-body text-foreground">{t.errors.internal}</span>
        <button
          type="button"
          onClick={core.retryLoad}
          className="inline-flex items-center gap-1.5 typo-caption text-foreground hover:text-foreground/80 cursor-pointer"
          data-testid="core-snapshot-retry"
        >
          <RefreshCw className="w-3.5 h-3.5" /> {t.common.retry}
        </button>
      </div>
    );
  }

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
