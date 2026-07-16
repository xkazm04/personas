/** PersonaCoreModal — the persona-core configurator.
 *
 *  Rethought (2026-07-08) against the real corpus: model tier × reasoning effort,
 *  a disposition slider + conflict style + a clickable character-trait palette.
 *  Memory is NOT here — the build surface's memory dimension owns it. The layout
 *  is the "Codex" design (won the /prototype round): an ordered, icon-forward
 *  3-column grid — Character · Configuration · Mentality.
 */
import { Suspense } from "react";
import { BaseModal } from "@/features/shared/components/modals";
import { LoadingSpinner } from "@/features/shared/components/feedback/LoadingSpinner";
import Button from "@/features/shared/components/buttons/Button";
import { RotateCcw } from "lucide-react";
import type { PersonaCore } from "./types";
import { lazyRetry } from "@/lib/lazyRetry";

// Lazy at the modal boundary: PersonaCoreCodex statically pulls
// archetypeGlyphData (~310KB of generated SVG path strings), which otherwise
// rides in the compose-surface chunk and is parsed on every entry into the
// build flow even though it renders only inside this explicitly-opened modal.
const PersonaCoreCodex = lazyRetry(() =>
  import("./PersonaCoreCodex").then((m) => ({ default: m.PersonaCoreCodex })),
);

export function PersonaCoreModal({ core, isOpen, onClose }: { core: PersonaCore; isOpen: boolean; onClose: () => void }) {
  return (
    <BaseModal isOpen={isOpen} onClose={onClose} titleId="persona-core-modal" size="6xl" maxWidthClass="max-w-[86rem]">
      <div className="flex flex-col gap-4 p-5" data-testid="persona-core-modal">
        <div className="flex flex-col gap-0.5">
          <h2 id="persona-core-modal" className="typo-heading-lg text-foreground">Persona core</h2>
          <span className="typo-caption">Who this agent is under the task — its disposition, character, and the model that runs it.</span>
        </div>

        {core.loading ? (
          <div className="py-16 flex justify-center"><LoadingSpinner label="Loading mentalities…" /></div>
        ) : (
          <Suspense fallback={<div className="py-16 flex justify-center"><LoadingSpinner label="Loading mentalities…" /></div>}>
            <PersonaCoreCodex core={core} />
          </Suspense>
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
