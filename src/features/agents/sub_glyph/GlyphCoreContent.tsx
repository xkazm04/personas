import { useState, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Sparkles, Play, CheckCircle2, Loader2, ArrowRight, RefreshCw,
} from "lucide-react";
import type { BuildPhase, BuildQuestion } from "@/lib/types/buildTypes";
import { useTranslation } from "@/i18n/useTranslation";
import { GlyphRefineComposer } from "./GlyphRefineComposer";
import { GlyphTestCompleteCore } from "./GlyphTestCompleteCore";
import { DebtText, debtText } from '@/i18n/DebtText';


interface GlyphCoreContentProps {
  isPreBuild: boolean;
  isBuilding: boolean;
  buildPhase: BuildPhase | null;
  hasDesignResult: boolean;
  refining: boolean;
  setRefining: (v: boolean) => void;
  completenessPct: number;
  pendingQuestions: BuildQuestion[] | null;
  testOutputLines?: string[];
  testPassed?: boolean | null;
  testError?: string | null;
  onStartTest: () => void | Promise<void>;
  onPromote: () => void;
  onPromoteForce?: () => void;
  onRejectTest?: () => void;
  onRefine?: (prompt: string) => void | Promise<void>;
  onViewAgent: () => void;
  onShowSimulate: () => void;
  buildSessionId: string | null;
  /** Pre-build only: clicking the center summons the intent overlay
   *  (CommandPanel). Required because the glyph is now the default
   *  surface — the form opens on demand instead of being rendered
   *  inline above the sigil. */
  onComposeStart?: () => void;
  /** test_complete only: opens the test-report modal so the user can
   *  see the full CLI output and the unclamped error message. */
  onShowReport?: () => void;
  /** Phase 5b — forwarded into GlyphTestCompleteCore for the "Split via
   *  Refine" button on capability cards. */
  onRequestSplit?: (capabilityTitle: string, prefilledPrompt: string) => void;
  /** Phase 5b — pre-populates the refine composer when a capability
   *  "Split" was just clicked. One-shot. */
  refinePrefill?: string | null;
  onClearRefinePrefill?: () => void;
}

/** Building-phase center status. While the LLM works (and the user can't
 *  help) the label gently advances through a few reassuring beats so the
 *  ~60s wait reads as deliberate progress rather than a hang; once a
 *  question is pending the label switches to "awaiting your answer" and
 *  stops advancing (the user is now the bottleneck). The real CLI output
 *  still streams in GlyphActivityStrip below the sigil. */
function GlyphBuildingStatus({ hasPending }: { hasPending: boolean }) {
  const { t } = useTranslation();
  const [beat, setBeat] = useState(0);
  useEffect(() => {
    if (hasPending) {
      setBeat(0);
      return;
    }
    const id = setInterval(() => setBeat((b) => Math.min(b + 1, 3)), 3600);
    return () => clearInterval(id);
  }, [hasPending]);

  const beats = [
    t.agents.glyph_build_beat_understanding,
    t.agents.glyph_build_beat_designing,
    t.agents.glyph_build_beat_wiring,
    t.agents.glyph_build_beat_assembling,
  ];
  const label = hasPending ? t.agents.glyph_build_awaiting : beats[beat];

  return (
    <motion.div
      key="building"
      initial={{ opacity: 0, scale: 0.9 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0 }}
      className="flex flex-col items-center gap-2 pointer-events-auto"
    >
      <div className="flex items-center gap-1.5 typo-caption text-foreground uppercase tracking-[0.18em]">
        <Loader2 className="w-3 h-3 animate-spin" />
        <AnimatePresence mode="wait">
          <motion.span
            key={label}
            initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -4 }}
            transition={{ duration: 0.3 }}
          >
            {label}
          </motion.span>
        </AnimatePresence>
      </div>
      {/* Backgroundability hint — surfaces only when the LLM is doing work
          the user can't help with. Stays subtle: muted, capped width. */}
      {!hasPending && (
        <span className="mt-2 typo-caption text-foreground text-center max-w-[220px] leading-snug">
          <DebtText k="auto_you_can_use_the_app_freely_while_this_buil_c0d5f08b" />
        </span>
      )}
    </motion.div>
  );
}

export function GlyphCoreContent(props: GlyphCoreContentProps) {
  const {
    isPreBuild, isBuilding, buildPhase, hasDesignResult,
    refining, setRefining, completenessPct, pendingQuestions,
    testOutputLines, onStartTest, onRefine, onViewAgent,
    onComposeStart, refinePrefill, onClearRefinePrefill,
  } = props;

  const { t } = useTranslation();

  if (isPreBuild) {
    // 2026-05-05 — when the parent doesn't supply onComposeStart, render
    // nothing instead of a faded disabled button. The composer-prototype
    // layout uses this to suppress the CTA whenever the user already has
    // a sigil active (their input affordance is the textarea, not the
    // button), and only re-shows it as a backup when no sigil carries
    // user state. Glyph Full passes onComposeStart unconditionally during
    // compose so its behaviour is unchanged.
    if (!onComposeStart) return null;
    return (
      <motion.button
        key="pre"
        type="button"
        onClick={onComposeStart}
        disabled={false}
        initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
        transition={{ duration: 0.3 }}
        whileHover={{ scale: 1.04 }}
        whileTap={{ scale: 0.97 }}
        aria-label={debtText("auto_click_to_begin_open_intent_composer_3188e888")}
        data-testid="glyph-compose-summon"
        className="flex flex-col items-center gap-2 px-6 pointer-events-auto cursor-pointer disabled:is-disabled group bg-transparent border-none outline-none focus-visible:ring-2 focus-visible:ring-primary/60 rounded-full"
      >
        {/* reduced-motion-ok: subtle decorative opacity/scale pulse on the compose-summon glyph; no vestibular hazard and it conveys no information */}
        <motion.div
          animate={{ opacity: [0.55, 1, 0.55], scale: [0.96, 1.06, 0.96] }}
          transition={{ duration: 2.4, repeat: Infinity, ease: "easeInOut" }}
          className="rounded-full"
          style={{ filter: "drop-shadow(0 0 16px rgba(96,165,250,0.55))" }}
        >
          <Sparkles className="w-9 h-9 text-primary/85 group-hover:text-primary transition-colors" />
        </motion.div>
        <span className="typo-label uppercase tracking-[0.22em] text-foreground group-hover:text-foreground transition-colors">
          <DebtText k="auto_click_to_begin_a3efa65a" />
        </span>
        <span className="typo-caption text-foreground max-w-[220px] leading-snug">
          <DebtText k="auto_describe_your_persona_276b0e90" />
        </span>
      </motion.button>
    );
  }

  if (refining) {
    return (
      <motion.div
        key="refine"
        initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0 }}
        className="flex flex-col items-center gap-2 w-full px-6 pointer-events-auto"
      >
        <GlyphRefineComposer
          initialText={refinePrefill ?? undefined}
          onSubmit={(v) => {
            setRefining(false);
            onClearRefinePrefill?.();
            void onRefine?.(v);
          }}
          onCancel={() => {
            setRefining(false);
            onClearRefinePrefill?.();
          }}
        />
      </motion.div>
    );
  }

  if (isBuilding) {
    const hasPending = !!pendingQuestions && pendingQuestions.length > 0;
    return <GlyphBuildingStatus hasPending={hasPending} />;
  }

  if (buildPhase === "testing") {
    return (
      <motion.div
        key="testing"
        initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
        className="flex flex-col items-center gap-2 w-full px-6 pointer-events-auto"
      >
        <Loader2 className="w-6 h-6 text-primary/70 animate-spin" />
        <span className="typo-label uppercase tracking-[0.2em] text-foreground"><DebtText k="auto_running_tests_7ec9eede" /></span>
        {testOutputLines && testOutputLines.length > 0 && (
          <div className="mt-1 w-full max-h-20 overflow-y-auto typo-caption font-mono text-foreground text-left">
            {testOutputLines.slice(-4).map((l, i) => (
              <div key={i} className="truncate">{l}</div>
            ))}
          </div>
        )}
      </motion.div>
    );
  }

  if (buildPhase === "test_complete") {
    return <GlyphTestCompleteCore {...props} />;
  }

  if (buildPhase === "promoted") {
    return (
      <motion.div
        key="promoted"
        initial={{ opacity: 0, scale: 0.9 }} animate={{ opacity: 1, scale: 1 }}
        className="flex flex-col items-center gap-2 pointer-events-auto"
      >
        <div className="relative flex items-center justify-center mb-0.5">
          {/* Radiating success pulse — a brief celebratory beat in the
              ~1.5s window before the build flow auto-redirects to the new
              agent, so promoting feels like an arrival, not a page swap. */}
          <motion.span
            className="absolute rounded-full border-2 border-emerald-400/60"
            initial={{ width: 36, height: 36, opacity: 0.7 }}
            animate={{ width: 88, height: 88, opacity: 0 }}
            transition={{ duration: 1, ease: "easeOut" }}
          />
          <motion.div
            initial={{ scale: 0.4, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            transition={{ type: "spring", stiffness: 360, damping: 15 }}
          >
            <CheckCircle2 className="w-10 h-10 text-emerald-400" />
          </motion.div>
        </div>
        <span className="typo-heading-sm text-foreground"><DebtText k="auto_agent_promoted_8df1a174" /></span>
        <span className="typo-caption text-foreground">{t.agents.glyph_promoted_ready}</span>
        <button
          type="button"
          onClick={onViewAgent}
          className="px-3 py-1.5 rounded-full bg-emerald-500/20 hover:bg-emerald-500/30 border border-emerald-400/40 typo-body text-foreground cursor-pointer flex items-center gap-1.5"
        >
          {t.agents.glyph_open} <ArrowRight className="w-3.5 h-3.5" />
        </button>
      </motion.div>
    );
  }

  if (hasDesignResult) {
    return (
      <motion.div
        key="draft"
        initial={{ opacity: 0, scale: 0.9 }} animate={{ opacity: 1, scale: 1 }}
        className="flex flex-col items-center gap-2 pointer-events-auto"
      >
        <span className="typo-label uppercase tracking-[0.2em] text-foreground"><DebtText k="auto_draft_ready_96b5a4f6" /></span>
        <span className="typo-heading-sm text-foreground">{completenessPct}<DebtText k="auto_complete_dfdcd775" /></span>
        <div className="flex items-center gap-1.5 flex-wrap justify-center">
          <button
            type="button"
            onClick={() => void onStartTest()}
            className="px-3 py-1.5 rounded-full bg-primary/25 hover:bg-primary/40 border border-primary/40 typo-body text-foreground cursor-pointer flex items-center gap-1.5"
          >
            <Play className="w-3.5 h-3.5" />
            <DebtText k="auto_run_test_e90380fe" />
          </button>
          {onRefine && (
            <button
              type="button"
              onClick={() => setRefining(true)}
              className="px-2.5 py-1.5 rounded-full bg-foreground/5 hover:bg-foreground/10 border border-border/30 typo-caption text-foreground cursor-pointer flex items-center gap-1"
            >
              <RefreshCw className="w-3 h-3" />
              {t.agents.glyph_refine}
            </button>
          )}
        </div>
      </motion.div>
    );
  }

  return null;
}
