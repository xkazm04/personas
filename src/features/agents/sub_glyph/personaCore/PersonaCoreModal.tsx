/** PersonaCoreModal — the persona-core configurator.
 *
 *  Consolidates the retired Foundry's foundation step: pick an archetype PRESET,
 *  then hand-tune the four knobs it seeds — Risk, Speed, Model, Memory. The
 *  "Console" design won the prototype (manual-first mixer with preset snapshot
 *  chips); the Atelier/Compass variants were retired.
 */
import { BaseModal } from "@/features/shared/components/modals";
import { LoadingSpinner } from "@/features/shared/components/feedback/LoadingSpinner";
import Button from "@/features/shared/components/buttons/Button";
import { RotateCcw } from "lucide-react";
import type { PersonaCore } from "./usePersonaCore";
import { CoreConsole } from "./CoreConsole";

export function PersonaCoreModal({ core, isOpen, onClose }: { core: PersonaCore; isOpen: boolean; onClose: () => void }) {
  return (
    <BaseModal isOpen={isOpen} onClose={onClose} titleId="persona-core-modal" size="xl">
      <div className="flex flex-col gap-4 p-5" data-testid="persona-core-modal">
        <div className="flex flex-col gap-0.5">
          <h2 id="persona-core-modal" className="typo-title-lg text-foreground">Persona core</h2>
          <span className="typo-caption">The temperament under the task — load a mentality, then tune Risk, Speed, Model &amp; Memory.</span>
        </div>

        {core.loading ? (
          <div className="py-16 flex justify-center"><LoadingSpinner label="Loading mentalities…" /></div>
        ) : (
          <CoreConsole core={core} />
        )}

        <div className="flex items-center justify-between gap-2 pt-1 border-t border-card-border/50">
          <button
            type="button"
            onClick={core.reset}
            disabled={!core.configured}
            className="inline-flex items-center gap-1.5 typo-caption text-foreground disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer hover:text-foreground/80"
          >
            <RotateCcw className="w-3.5 h-3.5" /> Reset to defaults
          </button>
          <Button variant="primary" size="sm" onClick={onClose} data-testid="persona-core-done">Done</Button>
        </div>
      </div>
    </BaseModal>
  );
}
