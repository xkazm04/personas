/** CentreDraft: Scene 5 (the title card) and Scene 6 (the verdict).
 *
 *  The draft is a title card: the name set large and editable, the role and
 *  mission, and the capabilities as a strip of contact prints. The verdict
 *  stamps the card PASSED or NOT PASSED. Promotion is one keypress only when
 *  `testPassed === true`. A failed or unknown result shows the error and puts
 *  "promote anyway" behind a second, explicit confirmation that is never bound
 *  to Enter and never focused by default. */
import { useState } from "react";
import { motion, useReducedMotion } from "framer-motion";
import { FlaskConical, Play, RefreshCw, Rocket, ScrollText, ThumbsDown } from "lucide-react";
import { useAgentStore } from "@/stores/agentStore";
import type { GlyphRow } from "@/features/shared/glyph";
import { WildButton } from "./WildButton";
import { COPY } from "./wildCopy";

interface CentreDraftProps {
  verdict: boolean;
  agentName: string;
  onAgentNameChange: (v: string) => void;
  completeness: number;
  rows: GlyphRow[];
  testPassed?: boolean | null;
  testError?: string | null;
  promoting: boolean;
  onStartTest: () => void | Promise<void>;
  onPromote: () => void;
  onPromoteForce?: () => void;
  onRejectTest?: () => void;
  onOpenRefine?: () => void;
  onOpenPrints: () => void;
  onShowReport: () => void;
  onShowSimulate: () => void;
}

export function CentreDraft(p: CentreDraftProps) {
  const reduce = useReducedMotion();
  const behaviorCore = useAgentStore((s) => s.buildBehaviorCore);
  const [armed, setArmed] = useState(false);
  const passed = p.testPassed === true;
  const rows = p.rows.filter((r) => r.enabled);

  return (
    <motion.div
      key={p.verdict ? "verdict" : "draft"}
      className="flex flex-col items-center gap-2.5 w-full"
      initial={{ opacity: 0, y: 12, filter: "blur(4px)" }}
      animate={{ opacity: 1, y: 0, filter: "blur(0px)" }}
      exit={{ opacity: 0, transition: { duration: 0.2 } }}
      transition={{ duration: 0.6 }}
    >
      <span className="csw-edge">{p.verdict ? COPY.verdict.eyebrow : COPY.draft.eyebrow} · {COPY.draft.complete(Math.round(p.completeness))}</span>
      <div className="relative">
        <input
          className="csw-display bg-transparent text-center outline-none w-[min(560px,80vw)]"
          style={{ fontSize: "clamp(30px, 3.4vw, 46px)", textTransform: "uppercase", color: "var(--cs-ink)", lineHeight: 1 }}
          value={p.agentName}
          onChange={(e) => p.onAgentNameChange(e.target.value)}
          placeholder={COPY.draft.namePh}
          aria-label={COPY.draft.namePh}
        />
        {p.verdict && (
          <motion.span
            className="csw-stamp absolute -right-2 -top-5"
            style={{ color: passed ? "var(--cs-ok)" : "var(--cs-bad)", background: "color-mix(in srgb, var(--cs-paper) 70%, transparent)" }}
            initial={reduce ? false : { scale: 2.4, rotate: -8, opacity: 0 }}
            animate={{ scale: 1, rotate: -8, opacity: 1 }}
            transition={{ type: "spring", stiffness: 380, damping: 16, delay: 0.25 }}
          >
            {passed ? COPY.verdict.passed : COPY.verdict.failed}
          </motion.span>
        )}
      </div>
      {behaviorCore?.mission && !p.verdict && (
        <p className="csw-serif m-0 max-w-[520px] line-clamp-2" style={{ fontSize: 16, color: "var(--cs-dim)" }}>{behaviorCore.mission}</p>
      )}
      {p.verdict && (
        <p className="m-0 max-w-[520px] line-clamp-3" style={{ fontSize: 15, color: passed ? "var(--cs-dim)" : "var(--cs-bad)" }}>
          {passed ? COPY.verdict.passedLine : p.testError || COPY.verdict.failedLine}
        </p>
      )}

      {rows.length > 0 && !armed && (
        <button type="button" onClick={p.onOpenPrints} className="flex gap-2 px-2 py-1.5 rounded" style={{ background: "var(--cs-film)" }} aria-label={COPY.draft.openPrints}>
          {rows.slice(0, 5).map((r, i) => (
            <span key={r.id} className="flex flex-col items-start gap-0.5 text-left px-2 py-1" style={{ width: 108, borderRight: i < Math.min(5, rows.length) - 1 ? "1px dashed rgba(255,236,210,.25)" : undefined }}>
              <span className="csw-edge" style={{ color: "#f0a55a" }}>{String(i + 1).padStart(2, "0")}A</span>
              <span className="truncate w-full" style={{ fontSize: 14, color: "#f2ebe0" }}>{r.title}</span>
            </span>
          ))}
          {rows.length > 5 && <span className="csw-edge self-center" style={{ color: "#f0a55a" }}>+{rows.length - 5}</span>}
        </button>
      )}

      {armed ? (
        <div className="flex flex-col items-center gap-2 max-w-[480px] px-4 py-3 rounded-input" style={{ border: "1px solid var(--cs-bad)", background: "color-mix(in srgb, var(--cs-bad) 8%, transparent)" }} role="alertdialog" aria-label={COPY.verdict.armTitle}>
          <strong style={{ fontSize: 16 }}>{COPY.verdict.armTitle}</strong>
          <span style={{ fontSize: 14, color: "var(--cs-dim)" }}>{COPY.verdict.armBody}</span>
          <div className="flex gap-2">
            <WildButton kind="ghost" onClick={() => setArmed(false)} autoFocus>{COPY.verdict.armKeep}</WildButton>
            <WildButton kind="danger" onClick={() => p.onPromoteForce?.()} busy={p.promoting} busyLabel={COPY.verdict.promoting} icon={<Rocket className="w-4 h-4" />}>{COPY.verdict.armGo}</WildButton>
          </div>
        </div>
      ) : (
        <div className="flex items-center gap-2 flex-wrap justify-center">
          {!p.verdict && <WildButton onClick={p.onStartTest} icon={<Play className="w-4 h-4" />} kbd="↵">{COPY.draft.screen}</WildButton>}
          {p.verdict && passed && <WildButton onClick={p.onPromote} busy={p.promoting} busyLabel={COPY.verdict.promoting} icon={<Rocket className="w-4 h-4" />} kbd="↵">{COPY.verdict.promote}</WildButton>}
          {p.verdict && !passed && p.onOpenRefine && <WildButton onClick={p.onOpenRefine} icon={<RefreshCw className="w-4 h-4" />}>{COPY.draft.refine}</WildButton>}
          {p.verdict && <WildButton kind="ghost" onClick={p.onShowReport} icon={<ScrollText className="w-4 h-4" />}>{COPY.verdict.report}</WildButton>}
          {p.verdict && <WildButton kind="ghost" onClick={p.onShowSimulate} icon={<FlaskConical className="w-4 h-4" />}>{COPY.verdict.simulate}</WildButton>}
          {(passed || !p.verdict) && p.onOpenRefine && <WildButton kind="ghost" onClick={p.onOpenRefine} icon={<RefreshCw className="w-4 h-4" />}>{COPY.draft.refine}</WildButton>}
          {p.verdict && p.onRejectTest && <button type="button" className="csw-link inline-flex items-center gap-1.5" onClick={p.onRejectTest}><ThumbsDown className="w-4 h-4" />{COPY.verdict.reject}</button>}
          {p.verdict && !passed && p.onPromoteForce && <button type="button" className="csw-link" onClick={() => setArmed(true)}>{COPY.verdict.anyway}</button>}
        </div>
      )}
    </motion.div>
  );
}
