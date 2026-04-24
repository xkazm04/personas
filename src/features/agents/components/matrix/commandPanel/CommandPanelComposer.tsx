/**
 * Composer command panel — "Message composer" metaphor.
 *
 * Diverges from the Workbench baseline in three ways:
 *   1. Vertical hero-first rhythm: the intent textarea owns the top half of
 *      the panel, borderless and typographically dominant — the textarea IS
 *      the stage, not a form field.
 *   2. Quick setup is demoted to an accessory toolbar beneath a subtle
 *      divider, reframing it as "attachments" to the prompt rather than an
 *      equal partner.
 *   3. Launch sits inline at the end of the composer like a Send action in
 *      a chat app (right-docked, slightly floating), keeping the action
 *      visually adjacent to the text the user just wrote.
 *
 * Ambient accent: a soft primary-tinted halo behind the composer so the
 * panel feels like the lit focal point of the pre-build screen.
 */
import { Sparkles, ArrowUp } from "lucide-react";
import { DimensionQuickConfig } from "@/features/agents/components/matrix/DimensionQuickConfig";
import type { CommandPanelProps } from "./types";

export function CommandPanelComposer({
  intentText, onIntentChange, onLaunch, launchDisabled, onKeyDown, onQuickConfigChange,
}: CommandPanelProps) {
  return (
    <div className="w-full max-w-5xl relative">
      {/* Ambient primary halo behind the composer — gives the panel a lit,
          focal feel without being an infinite animation. */}
      <div
        aria-hidden
        className="absolute -inset-6 rounded-modal pointer-events-none opacity-60"
        style={{
          background:
            "radial-gradient(60% 50% at 50% 40%, rgba(96,165,250,0.18), transparent 70%)",
        }}
      />

      <div className="relative flex flex-col gap-0 rounded-modal border border-card-border bg-gradient-to-br from-card-bg via-card-bg/85 to-primary/[0.06] backdrop-blur-lg shadow-elevation-3 overflow-hidden">
        {/* Hero textarea block — borderless, seamless with the panel */}
        <div className="flex flex-col gap-3 p-5 md:p-6">
          <div className="flex items-center gap-1.5 typo-label font-bold uppercase tracking-[0.22em] text-foreground/55">
            <Sparkles className="w-3.5 h-3.5 text-primary/80" />
            Intent
          </div>
          <textarea
            value={intentText}
            onChange={(e) => onIntentChange(e.target.value)}
            onKeyDown={onKeyDown}
            placeholder="When Gmail receives a support request, summarize it and post to Slack…"
            rows={6}
            data-testid="agent-intent-input"
            className="w-full bg-transparent typo-body-lg text-foreground placeholder:text-foreground/30 placeholder:italic focus:outline-none resize-none leading-relaxed px-0 py-0"
            style={{ fontSize: "1.05rem" }}
          />
        </div>

        {/* Divider between composer and attachments */}
        {onQuickConfigChange && (
          <div className="border-t border-border/20 bg-foreground/[0.015] px-5 md:px-6 py-4 flex flex-col gap-2">
            <div className="typo-label font-bold uppercase tracking-[0.22em] text-foreground/45">
              Attachments · quick setup
            </div>
            <DimensionQuickConfig onChange={onQuickConfigChange} />
          </div>
        )}

        {/* Footer action row — send-on-right composer pattern */}
        <div className="border-t border-border/20 bg-foreground/[0.025] px-5 md:px-6 py-3 flex items-center justify-between gap-3">
          <span className="typo-caption text-foreground/40">
            Enter to summon · Shift + Enter for a new line
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
      </div>
    </div>
  );
}
