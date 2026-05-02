import { motion } from "framer-motion";
import {
  Sparkles, Play, CheckCircle2, Loader2, ArrowRight, RefreshCw,
} from "lucide-react";
import type { BuildPhase, BuildQuestion } from "@/lib/types/buildTypes";
import { GlyphRefineComposer } from "./GlyphRefineComposer";
import { GlyphTestCompleteCore } from "./GlyphTestCompleteCore";

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
}

export function GlyphCoreContent(props: GlyphCoreContentProps) {
  const {
    isPreBuild, isBuilding, buildPhase, hasDesignResult,
    refining, setRefining, completenessPct, pendingQuestions,
    testOutputLines, onStartTest, onRefine, onViewAgent,
    onComposeStart,
  } = props;

  if (isPreBuild) {
    return (
      <motion.button
        key="pre"
        type="button"
        onClick={onComposeStart}
        disabled={!onComposeStart}
        initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
        transition={{ duration: 0.3 }}
        whileHover={{ scale: 1.04 }}
        whileTap={{ scale: 0.97 }}
        aria-label="Click to begin — open intent composer"
        data-testid="glyph-compose-summon"
        className="flex flex-col items-center gap-2 px-6 pointer-events-auto cursor-pointer disabled:cursor-not-allowed disabled:opacity-60 group bg-transparent border-none outline-none focus-visible:ring-2 focus-visible:ring-primary/60 rounded-full"
      >
        <motion.div
          animate={{ opacity: [0.55, 1, 0.55], scale: [0.96, 1.06, 0.96] }}
          transition={{ duration: 2.4, repeat: Infinity, ease: "easeInOut" }}
          className="rounded-full"
          style={{ filter: "drop-shadow(0 0 16px rgba(96,165,250,0.55))" }}
        >
          <Sparkles className="w-9 h-9 text-primary/85 group-hover:text-primary transition-colors" />
        </motion.div>
        <span className="typo-label uppercase tracking-[0.22em] text-foreground/70 group-hover:text-foreground transition-colors">
          Click to Begin
        </span>
        <span className="typo-caption text-foreground/45 max-w-[220px] leading-snug">
          Describe your agent — its sigil will weave here.
        </span>
      </motion.button>
    );
  }

  if (refining) {
    return (
      <motion.div
        key="refine"
        initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0 }}
        className="flex flex-col items-center gap-2 w-full px-6"
      >
        <GlyphRefineComposer
          onSubmit={(v) => { setRefining(false); void onRefine?.(v); }}
          onCancel={() => setRefining(false)}
        />
      </motion.div>
    );
  }

  if (isBuilding) {
    return (
      <motion.div
        key="building"
        initial={{ opacity: 0, scale: 0.9 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0 }}
        className="flex flex-col items-center gap-1 pointer-events-auto"
      >
        <div className="typo-hero font-bold text-foreground tabular-nums tracking-tight">
          {completenessPct}
          <span className="typo-heading-sm text-foreground/40 ml-0.5">%</span>
        </div>
        <div className="flex items-center gap-1.5 typo-caption text-foreground/60 uppercase tracking-[0.18em]">
          <Loader2 className="w-3 h-3 animate-spin" />
          {pendingQuestions && pendingQuestions.length > 0 ? "Awaiting your answer" : "Weaving intent"}
        </div>
      </motion.div>
    );
  }

  if (buildPhase === "testing") {
    return (
      <motion.div
        key="testing"
        initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
        className="flex flex-col items-center gap-2 w-full px-6"
      >
        <Loader2 className="w-6 h-6 text-primary/70 animate-spin" />
        <span className="typo-label uppercase tracking-[0.2em] text-foreground/60">Running Tests</span>
        {testOutputLines && testOutputLines.length > 0 && (
          <div className="mt-1 w-full max-h-20 overflow-y-auto typo-caption font-mono text-foreground/50 text-left">
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
        <CheckCircle2 className="w-10 h-10 text-emerald-400" />
        <span className="typo-heading-sm text-foreground">Agent Promoted</span>
        <button
          type="button"
          onClick={onViewAgent}
          className="px-3 py-1.5 rounded-full bg-emerald-500/20 hover:bg-emerald-500/30 border border-emerald-400/40 typo-body text-foreground cursor-pointer flex items-center gap-1.5"
        >
          Open <ArrowRight className="w-3.5 h-3.5" />
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
        <span className="typo-label uppercase tracking-[0.2em] text-foreground/60">Draft Ready</span>
        <span className="typo-heading-sm text-foreground">{completenessPct}% complete</span>
        <div className="flex items-center gap-1.5 flex-wrap justify-center">
          <button
            type="button"
            onClick={() => void onStartTest()}
            className="px-3 py-1.5 rounded-full bg-primary/25 hover:bg-primary/40 border border-primary/40 typo-body text-foreground cursor-pointer flex items-center gap-1.5"
          >
            <Play className="w-3.5 h-3.5" />
            Run Test
          </button>
          {onRefine && (
            <button
              type="button"
              onClick={() => setRefining(true)}
              className="px-2.5 py-1.5 rounded-full bg-foreground/5 hover:bg-foreground/10 border border-border/30 typo-caption text-foreground/75 cursor-pointer flex items-center gap-1"
            >
              <RefreshCw className="w-3 h-3" />
              Refine
            </button>
          )}
        </div>
      </motion.div>
    );
  }

  return null;
}
