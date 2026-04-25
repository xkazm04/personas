/**
 * Baseline command panel — "Workbench" metaphor.
 *
 * Horizontal 2-column split inside a single rounded-modal card:
 *   · Left (flex-[3]): intent textarea with its own label
 *   · Right (flex-[2]): DimensionQuickConfig with its own label
 * Footer row: keyboard hint + Launch.
 *
 * Both columns share visual weight; the setup is treated as a sibling of
 * the intent rather than a subordinate toolbar. This is the shipped design
 * from which the Composer variant diverges.
 */
import { Sparkles, Play } from "lucide-react";
import { DimensionQuickConfig } from "@/features/agents/components/matrix/DimensionQuickConfig";
import type { CommandPanelProps } from "./types";

export function CommandPanelBaseline({
  intentText, onIntentChange, onLaunch, launchDisabled, onKeyDown, onQuickConfigChange,
}: CommandPanelProps) {
  return (
    <div className="w-full min-w-[760px] 2xl:min-w-[1080px] 3xl:min-w-[1340px] max-w-[1500px] flex flex-col gap-3 rounded-modal border border-card-border bg-card-bg/60 backdrop-blur-lg shadow-elevation-3 p-4 md:p-5">
      <div className="flex flex-col lg:flex-row gap-4">
        <div className="flex-[3] min-w-0 flex flex-col gap-2">
          <div className="flex items-center gap-1.5 typo-label font-bold uppercase tracking-[0.18em] text-foreground/55">
            <Sparkles className="w-3.5 h-3.5 text-primary/80" />
            Describe your agent
          </div>
          <textarea
            value={intentText}
            onChange={(e) => onIntentChange(e.target.value)}
            onKeyDown={onKeyDown}
            placeholder="When Gmail receives a support request, summarize it and post to Slack…"
            rows={5}
            data-testid="agent-intent-input"
            className="w-full px-3 py-3 rounded-modal bg-primary/5 border border-card-border typo-body-lg text-foreground placeholder:text-foreground/35 focus:outline-none focus:border-primary/40 resize-none leading-relaxed"
          />
        </div>
        {onQuickConfigChange && (
          <div className="flex-[2] min-w-0 flex flex-col gap-2">
            <div className="typo-label font-bold uppercase tracking-[0.18em] text-foreground/55">
              Quick setup
            </div>
            <div className="rounded-modal bg-primary/5 border border-card-border p-2">
              <DimensionQuickConfig onChange={onQuickConfigChange} />
            </div>
          </div>
        )}
      </div>
      <div className="flex items-center justify-between gap-3 pt-1">
        <span className="typo-caption text-foreground/40">
          Enter to summon · Shift + Enter for a new line
        </span>
        <button
          type="button"
          onClick={onLaunch}
          disabled={launchDisabled}
          data-testid="agent-launch-btn"
          className="px-5 py-2 rounded-full bg-primary/25 hover:bg-primary/40 border border-primary/40 typo-body font-medium text-foreground disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer flex items-center gap-2 transition-all"
          style={{ boxShadow: "0 0 24px rgba(96,165,250,0.25)" }}
        >
          <Play className="w-3.5 h-3.5" />
          Summon Agent
        </button>
      </div>
    </div>
  );
}
