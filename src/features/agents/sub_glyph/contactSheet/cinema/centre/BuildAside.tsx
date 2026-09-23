/** BuildAside - the quiet lines under the slate while the build runs: that
 *  the app stays usable, which recipe the build started from (if one was
 *  picked on the compose act), and the build's live output as a single line
 *  that opens the full log one layer down. The single line is the old
 *  GlyphActivityStrip's collapsed state; its expanded state is the log layer. */
import { ChevronRight, Sparkles, Terminal } from "lucide-react";
import { useTranslation } from "@/i18n/useTranslation";
import { debtText } from "@/i18n/DebtText";
import type { PickedRecipe } from "../useCinemaRecipes";
import { COPY } from "../copy";

/** The catalog sentence joins its halves with a dash; this surface uses a comma. */
const undash = (s: string) => s.replace(/\s*[–—]\s*/g, ", ");

export function LogLine({ lines, onOpen }: { lines: string[]; onOpen: (el: HTMLElement) => void }) {
  const latest = lines[lines.length - 1];
  if (!latest) return null;
  return (
    <button
      type="button"
      onClick={(e) => onOpen(e.currentTarget)}
      aria-label={COPY.buildLog}
      data-testid="sheet-cinema-build-log-open"
      className="w-full max-w-[420px] flex items-center gap-2 h-8 px-2.5 rounded-interactive border border-card-border bg-background/60 text-left hover:bg-foreground/5"
    >
      <Terminal className="w-3.5 h-3.5 shrink-0 text-foreground" aria-hidden />
      <span className="flex-1 min-w-0 truncate font-mono typo-caption text-foreground">{latest}</span>
      <ChevronRight className="w-3.5 h-3.5 shrink-0 text-foreground" aria-hidden />
    </button>
  );
}

interface BuildAsideProps {
  picked: PickedRecipe | null;
  lines: string[];
  /** Short centre cell: only the log line stays. */
  tight?: boolean;
  onOpenLog: (el: HTMLElement) => void;
}

export function BuildAside({ picked, lines, tight = false, onOpenLog }: BuildAsideProps) {
  useTranslation(); // re-render on a locale change; debtText reads the active bundle
  return (
    <div className="w-full flex flex-col items-center gap-1.5">
      {!tight && (
        <span className="typo-body text-foreground max-w-[420px]">
          {undash(debtText("auto_you_can_use_the_app_freely_while_this_buil_c0d5f08b"))}
        </span>
      )}
      {picked && (
        <span className="inline-flex items-center gap-1.5 typo-caption text-foreground max-w-[420px]" data-testid="sheet-cinema-recipe-provenance">
          <Sparkles className="w-3.5 h-3.5 shrink-0" style={{ color: "var(--cinema-accent)" }} aria-hidden />
          <span className="truncate">{COPY.recipes.buildingOn} · {picked.name}</span>
        </span>
      )}
      <LogLine lines={lines} onOpen={onOpenLog} />
    </div>
  );
}
