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
import { ErrorBoundary } from "@/features/shared/components/feedback/ErrorBoundary";
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

/** The calm, geometry-matched placeholder for the codex body — used for BOTH
 *  waits (the archetype fetch and the lazy chunk) so a cold open settles once
 *  instead of stacking two differently-shaped skeletons. It ghosts the three
 *  columns' silhouette, holds the body height so arrival replaces rather than
 *  rearranges, and sits behind a 150ms CSS delay (fill-mode both) so a warm
 *  open never flashes it. `feedback/LoadingSpinner` used to stand here and
 *  renders `null`, i.e. the modal body was blank for the whole wait. */
function CodexGhost() {
  return (
    <div
      aria-hidden="true"
      className="flex flex-col lg:flex-row gap-6 min-h-[24rem] animate-fade-in"
      style={{ animationDelay: "150ms" }}
    >
      {[0, 1, 2].map((col) => (
        <div key={col} className="flex-1 min-w-0 flex flex-col gap-3">
          <span className="h-4 w-28 rounded-input bg-secondary/60" />
          <div className="flex flex-col gap-1.5">
            {[0, 1, 2, 3, 4].map((row) => (
              <span key={row} className="h-8 w-full rounded-input bg-secondary/30" />
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

export function PersonaCoreModal({ core, isOpen, onClose }: { core: PersonaCore; isOpen: boolean; onClose: () => void }) {
  return (
    <BaseModal isOpen={isOpen} onClose={onClose} titleId="persona-core-modal" size="6xl" maxWidthClass="max-w-[86rem]">
      <div className="flex flex-col gap-4 p-5" data-testid="persona-core-modal">
        <div className="flex flex-col gap-0.5">
          <h2 id="persona-core-modal" className="typo-heading-lg text-foreground">Persona core</h2>
          <span className="typo-caption">Who this agent is under the task — its disposition, character, and the model that runs it.</span>
        </div>

        {core.loading ? (
          <CodexGhost />
        ) : (
          // The codex is a lazy chunk, and lazyRetry's contract is that a
          // permanent import failure is rethrown to the NEAREST ErrorBoundary.
          // Without one here that failure escapes the modal and takes the whole
          // compose surface down; with it, the failure occupies only the
          // territory the codex would have and "Try again" closes back to the
          // build surface the user came from.
          <ErrorBoundary name="PersonaCore" onReset={onClose}>
            <Suspense fallback={<CodexGhost />}>
              <PersonaCoreCodex core={core} />
            </Suspense>
          </ErrorBoundary>
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
