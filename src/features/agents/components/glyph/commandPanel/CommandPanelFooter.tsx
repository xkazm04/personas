import { ArrowUp, Loader2 } from "lucide-react";
import { useCallback, useEffect, useState } from "react";

interface CommandPanelFooterProps {
  launchDisabled: boolean;
  onLaunch: () => void;
  /** True while the build session is actively running. Drives the
   *  spinner once the phase has flipped to analyzing/resolving. */
  isBuilding?: boolean;
}

/** Submit row. Two pieces of feedback on click:
 *  1. An optimistic local `pressed` flag flips immediately on click and
 *     swaps the ArrowUp icon for a spinner — the user sees the click
 *     register even before the build phase has officially flipped.
 *  2. Once `isBuilding` arrives true the local flag is no longer
 *     load-bearing (the real signal has caught up). When the parent
 *     unmounts this footer (the layout swaps out of compose) both
 *     concerns are moot.
 *
 *  An `active:scale-95` flash on the button itself adds a tactile
 *  "pressed" cue independent of the icon swap. */
export function CommandPanelFooter({
  launchDisabled,
  onLaunch,
  isBuilding = false,
}: CommandPanelFooterProps) {
  const [pressed, setPressed] = useState(false);

  // Reset the optimistic flag once the real `isBuilding` signal catches
  // up (or if the user somehow ends up disabled without launching).
  useEffect(() => {
    if (isBuilding) setPressed(false);
  }, [isBuilding]);

  const handleClick = useCallback(() => {
    if (launchDisabled) return;
    setPressed(true);
    onLaunch();
  }, [launchDisabled, onLaunch]);

  const showSpinner = pressed || isBuilding;
  const buttonDisabled = launchDisabled || showSpinner;

  return (
    <div className="border-t border-border/25 bg-foreground/[0.03] px-5 md:px-6 py-3 flex items-center justify-between gap-3">
      <span className="typo-caption text-foreground/75">
        <kbd className="font-medium text-foreground/90">Enter</kbd> to summon ·{" "}
        <kbd className="font-medium text-foreground/90">Shift + Enter</kbd> for a new line
      </span>
      <button
        type="button"
        onClick={handleClick}
        disabled={buttonDisabled}
        data-testid="agent-launch-btn"
        aria-label={showSpinner ? "Summoning agent…" : "Summon agent"}
        aria-busy={showSpinner}
        className="w-10 h-10 shrink-0 rounded-full bg-primary/30 hover:bg-primary/50 border border-primary/50 text-foreground disabled:opacity-30 disabled:cursor-not-allowed cursor-pointer flex items-center justify-center transition-all active:scale-95"
        style={{ boxShadow: "0 0 22px rgba(96,165,250,0.3)" }}
      >
        {showSpinner ? (
          <Loader2 className="w-4 h-4 animate-spin" />
        ) : (
          <ArrowUp className="w-4 h-4" />
        )}
      </button>
    </div>
  );
}
