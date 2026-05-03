import { motion } from "framer-motion";
import {
  CheckCircle2, AlertCircle, Rocket, ThumbsDown, RefreshCw, FlaskConical, ScrollText,
} from "lucide-react";
import { useTranslation } from "@/i18n/useTranslation";
import { GlyphCapabilityPreview } from "./GlyphCapabilityPreview";

interface GlyphTestCompleteCoreProps {
  testPassed?: boolean | null;
  testError?: string | null;
  buildSessionId: string | null;
  onPromote: () => void;
  onPromoteForce?: () => void;
  onRefine?: (prompt: string) => void | Promise<void>;
  onRejectTest?: () => void;
  setRefining: (v: boolean) => void;
  onShowSimulate: () => void;
  /** Opens the test-report modal showing full testOutputLines + the
   *  unclamped error message. Especially load-bearing on failure: the
   *  inline preview is line-clamp-2, this is how the user gets at the
   *  rest. */
  onShowReport?: () => void;
  /** Phase 5b — forwarded into the capability preview's "Split" button.
   *  The handler should pre-populate the Refine composer with the given
   *  prompt and switch the wizard into refining mode. */
  onRequestSplit?: (capabilityTitle: string, prefilledPrompt: string) => void;
}

export function GlyphTestCompleteCore({
  testPassed, testError, buildSessionId,
  onPromote, onPromoteForce, onRefine, onRejectTest,
  setRefining, onShowSimulate, onShowReport, onRequestSplit,
}: GlyphTestCompleteCoreProps) {
  const { t } = useTranslation();
  return (
    <motion.div
      key="test-complete"
      initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }}
      className="pointer-events-auto"
    >
      {/* Non-transparent backdrop wraps the whole card content. The
          buttons row tends to wrap to multiple lines and overflow the
          sigil's centre area (size * 0.56 ~358px); without an opaque
          surface the wrap collides visually with the petal/orbit
          layer underneath. */}
      <div className="rounded-modal bg-background/95 backdrop-blur-md border border-card-border shadow-elevation-2 px-4 py-3 flex flex-col items-center gap-2">
        {testPassed ? (
          <>
            <CheckCircle2 className="w-8 h-8 text-emerald-400" />
            <span className="typo-label uppercase tracking-[0.2em] text-emerald-400">Tests Passed</span>
          </>
        ) : (
          <>
            <AlertCircle className="w-8 h-8 text-orange-400" />
            <span className="typo-label uppercase tracking-[0.2em] text-orange-400">Tests Failed</span>
            {testError && (
              <p className="typo-caption text-foreground/60 max-w-[240px] line-clamp-2">{testError}</p>
            )}
          </>
        )}
        {/* A-grade Phase 5: surface the capability split before promote so
         *  the user consents to the LLM's structural choice instead of
         *  inheriting it. Phase 5b adds Remove + Split-via-Refine
         *  affordances per capability. Renders nothing when no
         *  capabilities have landed. */}
        <GlyphCapabilityPreview onRequestSplit={onRequestSplit} />
        <div className="mt-1 flex items-center gap-1.5 flex-wrap justify-center">
          <button
            type="button"
            onClick={testPassed ? onPromote : () => onPromoteForce?.()}
            className="px-3 py-1.5 rounded-full bg-primary/25 hover:bg-primary/40 border border-primary/40 typo-body text-foreground cursor-pointer flex items-center gap-1.5"
          >
            <Rocket className="w-3.5 h-3.5" />
            {testPassed ? "Promote" : "Promote Anyway"}
          </button>
          {onShowReport && (
            <button
              type="button"
              data-testid="build-test-report-open"
              onClick={onShowReport}
              className="px-3 py-1.5 rounded-full bg-foreground/5 hover:bg-foreground/10 border border-border/30 typo-body text-foreground/80 cursor-pointer flex items-center gap-1.5"
              aria-label="View test logs"
              title="See full CLI output and error details"
            >
              <ScrollText className="w-3.5 h-3.5" />
              View Logs
            </button>
          )}
          <button
            type="button"
            data-testid="build-simulate-open"
            onClick={onShowSimulate}
            disabled={!buildSessionId}
            className="px-3 py-1.5 rounded-full bg-foreground/5 hover:bg-foreground/10 disabled:opacity-50 disabled:cursor-not-allowed border border-border/30 typo-body text-foreground/80 cursor-pointer flex items-center gap-1.5"
            title={t.agents.build_simulate.subtitle}
          >
            <FlaskConical className="w-3.5 h-3.5" />
            {t.agents.build_simulate.open_button}
          </button>
          {onRefine && (
            <button
              type="button"
              onClick={() => setRefining(true)}
              className="px-3 py-1.5 rounded-full bg-foreground/5 hover:bg-foreground/10 border border-border/30 typo-body text-foreground/80 cursor-pointer flex items-center gap-1.5"
            >
              <RefreshCw className="w-3.5 h-3.5" />
              Refine
            </button>
          )}
          {onRejectTest && (
            <button
              type="button"
              onClick={onRejectTest}
              className="px-2.5 py-1.5 rounded-full text-foreground/55 hover:text-foreground typo-caption cursor-pointer flex items-center gap-1"
            >
              <ThumbsDown className="w-3 h-3" />
              Reject
            </button>
          )}
        </div>
      </div>
    </motion.div>
  );
}
