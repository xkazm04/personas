import { ArrowUp } from "lucide-react";

interface CommandPanelFooterProps {
  launchDisabled: boolean;
  onLaunch: () => void;
}

export function CommandPanelFooter({ launchDisabled, onLaunch }: CommandPanelFooterProps) {
  return (
    <div className="border-t border-border/25 bg-foreground/[0.03] px-5 md:px-6 py-3 flex items-center justify-between gap-3">
      <span className="typo-caption text-foreground/75">
        <kbd className="font-medium text-foreground/90">Enter</kbd> to summon ·{" "}
        <kbd className="font-medium text-foreground/90">Shift + Enter</kbd> for a new line
      </span>
      <button
        type="button"
        onClick={onLaunch}
        disabled={launchDisabled}
        data-testid="agent-launch-btn"
        aria-label="Summon agent"
        className="w-10 h-10 shrink-0 rounded-full bg-primary/30 hover:bg-primary/50 border border-primary/50 text-foreground disabled:opacity-30 disabled:cursor-not-allowed cursor-pointer flex items-center justify-center transition-all"
        style={{ boxShadow: "0 0 22px rgba(96,165,250,0.3)" }}
      >
        <ArrowUp className="w-4 h-4" />
      </button>
    </div>
  );
}
