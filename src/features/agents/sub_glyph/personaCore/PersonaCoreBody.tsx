/** PersonaCoreBody — the configurator's content without any host chrome: the
 *  Codex (or its ghost while it loads) over a footer with Reset and Done.
 *  Hosted by `PersonaCoreModal` and by the Sheet · Cinema loupe layer, which
 *  gives it the whole stage (`fill`) instead of a modal's fixed width. */
import { Suspense } from "react";
import { RotateCcw } from "lucide-react";
import { ErrorBoundary } from "@/features/shared/components/feedback/ErrorBoundary";
import Button from "@/features/shared/components/buttons/Button";
import { useTranslation } from "@/i18n/useTranslation";
import { lazyRetry } from "@/lib/lazyRetry";
import type { PersonaCore } from "./types";

// Lazy at the body boundary: PersonaCoreCodex statically pulls
// archetypeGlyphData (~310KB of generated SVG path strings), which otherwise
// rides in the compose-surface chunk and is parsed on every entry into the
// build flow even though it renders only once the configurator is opened.
const PersonaCoreCodex = lazyRetry(() =>
  import("./PersonaCoreCodex").then((m) => ({ default: m.PersonaCoreCodex })),
);

/** The calm, geometry-matched placeholder for the codex body — used for BOTH
 *  waits (the archetype fetch and the lazy chunk) so a cold open settles once
 *  instead of stacking two differently-shaped skeletons. It ghosts the three
 *  columns' silhouette, holds the body height so arrival replaces rather than
 *  rearranges, and sits behind a 150ms CSS delay (fill-mode both) so a warm
 *  open never flashes it. */
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

interface PersonaCoreBodyProps {
  core: PersonaCore;
  /** The user is done: the host records the selection and closes. */
  onDone: () => void;
  /** Crash recovery from the lazy codex: close WITHOUT recording a selection
   *  the user never saw. */
  onCrashReset: () => void;
  /** Fill the host's height (a stage-sized layer) instead of capping at 64vh. */
  fill?: boolean;
}

export function PersonaCoreBody({ core, onDone, onCrashReset, fill = false }: PersonaCoreBodyProps) {
  const { t } = useTranslation();
  return (
    <div className={fill ? "flex-1 min-h-0 flex flex-col gap-4" : "contents"}>
      {core.loading ? (
        <CodexGhost />
      ) : (
        // lazyRetry rethrows a permanent import failure to the NEAREST
        // ErrorBoundary. Without one here it escapes and takes the whole
        // compose surface down; with it, the failure occupies only the codex's
        // territory and "Try again" closes back to the build surface.
        <ErrorBoundary name="PersonaCore" onReset={onCrashReset}>
          <Suspense fallback={<CodexGhost />}>
            <PersonaCoreCodex core={core} fill={fill} />
          </Suspense>
        </ErrorBoundary>
      )}

      <div className={`flex items-center justify-between gap-2 ${fill ? "pt-3" : "pt-1"} border-t border-card-border/50 flex-shrink-0`}>
        <button
          type="button"
          onClick={core.reset}
          disabled={!core.configured}
          className={`inline-flex items-center gap-1.5 ${fill ? "typo-body" : "typo-caption"} text-foreground disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer hover:text-foreground/80`}
        >
          <RotateCcw className="w-3.5 h-3.5" /> {t.agents.core_reset}
        </button>
        <Button variant="primary" size={fill ? "md" : "sm"} onClick={onDone} data-testid="persona-core-done">{t.common.done}</Button>
      </div>
    </div>
  );
}
