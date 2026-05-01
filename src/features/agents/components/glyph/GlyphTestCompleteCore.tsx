import { motion } from "framer-motion";
import {
  CheckCircle2, AlertCircle, Rocket, ThumbsDown, RefreshCw, FlaskConical,
} from "lucide-react";
import { useTranslation } from "@/i18n/useTranslation";

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
}

export function GlyphTestCompleteCore({
  testPassed, testError, buildSessionId,
  onPromote, onPromoteForce, onRefine, onRejectTest,
  setRefining, onShowSimulate,
}: GlyphTestCompleteCoreProps) {
  const { t } = useTranslation();
  return (
    <motion.div
      key="test-complete"
      initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }}
      className="flex flex-col items-center gap-2 pointer-events-auto"
    >
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
      <div className="mt-1 flex items-center gap-1.5 flex-wrap justify-center">
        <button
          type="button"
          onClick={testPassed ? onPromote : () => onPromoteForce?.()}
          className="px-3 py-1.5 rounded-full bg-primary/25 hover:bg-primary/40 border border-primary/40 typo-body text-foreground cursor-pointer flex items-center gap-1.5"
        >
          <Rocket className="w-3.5 h-3.5" />
          {testPassed ? "Promote" : "Promote Anyway"}
        </button>
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
    </motion.div>
  );
}
