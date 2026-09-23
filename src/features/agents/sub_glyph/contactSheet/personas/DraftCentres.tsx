/** DraftCentres - the middle cell from the draft to the premiere: the title
 *  card (name, role, mission, capability prints), the screening while tests
 *  run, the verdict with stamped prints, and the premiere poster. */
import { useState } from "react";
import { motion } from "framer-motion";
import { ArrowRight, Pencil, Play, RefreshCw, Rocket, ScrollText, ThumbsDown } from "lucide-react";
import Button from "@/features/shared/components/buttons/Button";
import AsyncButton from "@/features/shared/components/buttons/AsyncButton";
import { useTranslation } from "@/i18n/useTranslation";
import { INPUT_FIELD } from "@/lib/utils/designTokens";
import { PrintStrip, type PrintItem } from "./PrintStrip";
import { COPY } from "./copy";

const EASE = [0.2, 0.7, 0.2, 1] as const;

export function TitleName({ name, onRename, size = "hero" }: { name: string; onRename?: (v: string) => void; size?: "hero" | "heading" }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(name);
  const cls = size === "hero" ? "typo-hero" : "typo-heading-lg";
  if (editing && onRename) {
    const commit = () => { const v = draft.trim(); if (v) onRename(v); setEditing(false); };
    return (
      <input
        autoFocus
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => { if (e.key === "Enter") commit(); if (e.key === "Escape") { e.stopPropagation(); setEditing(false); } }}
        className={`${INPUT_FIELD} max-w-[420px] text-center`}
        aria-label={COPY.slateAgent}
      />
    );
  }
  return (
    <span className="group inline-flex items-center gap-2">
      <h1 className={`${cls} text-foreground text-center`} aria-label={name}>
        {Array.from(name).map((ch, i) => (
          <motion.span
            key={`${name}-${i}`}
            aria-hidden
            className="inline-block whitespace-pre"
            initial={{ opacity: 0, y: 12, filter: "blur(8px)" }}
            animate={{ opacity: 1, y: 0, filter: "blur(0px)" }}
            transition={{ delay: 0.25 + i * 0.03, duration: 0.6, ease: EASE }}
          >
            {ch}
          </motion.span>
        ))}
      </h1>
      {onRename && (
        <Button variant="ghost" size="icon-sm" aria-label={COPY.slateAgent} onClick={() => { setDraft(name); setEditing(true); }} className="opacity-0 group-hover:opacity-100 focus-visible:opacity-100">
          <Pencil className="w-3.5 h-3.5" />
        </Button>
      )}
    </span>
  );
}

interface DraftProps {
  role: string | null;
  name: string;
  mission: string | null;
  prints: PrintItem[];
  resetKey: string;
  onRename: (v: string) => void;
  onStartTest: () => void | Promise<void>;
  onRefine?: () => void;
}

export function DraftCentre({ role, name, mission, prints, resetKey, onRename, onStartTest, onRefine }: DraftProps) {
  const { t } = useTranslation();
  return (
    <div className="flex flex-col items-center gap-2.5 w-full text-center">
      <span className="typo-label text-primary">{role ?? COPY.draftLabel}</span>
      <TitleName name={name} onRename={onRename} />
      {mission && <p className="typo-body text-foreground max-w-[480px] line-clamp-2">{mission}</p>}
      <PrintStrip items={prints} resetKey={resetKey} />
      <div className="flex items-center gap-2 pt-1">
        <AsyncButton variant="primary" size="md" icon={<Play className="w-4 h-4" />} onClick={() => onStartTest()} data-testid="cs-personas-test">
          {COPY.runTests}
        </AsyncButton>
        {onRefine && <Button variant="ghost" size="md" icon={<RefreshCw className="w-4 h-4" />} onClick={onRefine}>{t.agents.glyph_refine}</Button>}
      </div>
    </div>
  );
}

export function TestingCentre({ prints, resetKey, lines }: { prints: PrintItem[]; resetKey: string; lines: string[] }) {
  return (
    <div className="flex flex-col items-center gap-3 w-full">
      <PrintStrip items={prints} resetKey={resetKey} />
      <div className="w-full max-w-[480px] rounded-card border border-card-border bg-card-bg px-3.5 py-2.5 text-left min-h-16">
        {lines.length > 0 ? lines.slice(-3).map((l, i) => (
          <div key={`${i}-${l}`} className="typo-code text-foreground truncate">{l}</div>
        )) : <span className="typo-caption">{COPY.testingNote}</span>}
      </div>
      <Button variant="primary" size="md" loading loadingLabel={COPY.testing} disabled>{COPY.testing}</Button>
    </div>
  );
}

interface VerdictProps {
  passed: boolean;
  prints: PrintItem[];
  resetKey: string;
  okCount: number;
  error: string | null;
  onPromote: () => void;
  onPromoteAnyway?: () => void;
  onShowLog: () => void;
  onRefine?: () => void;
  onReject?: () => void;
}

export function VerdictCentre({ passed, prints, resetKey, okCount, error, onPromote, onPromoteAnyway, onShowLog, onRefine, onReject }: VerdictProps) {
  const { t } = useTranslation();
  const total = prints.length;
  const headline = total > 0 ? COPY.testsPassed(okCount, total) : passed ? COPY.testsAllPassed : COPY.testsFailed;
  return (
    <div className="flex flex-col items-center gap-2.5 w-full text-center">
      <PrintStrip items={prints} resetKey={resetKey} />
      <span className={`typo-title-lg ${passed ? "text-status-success" : "text-status-error"}`}>{headline}</span>
      {!passed && error && <p className="typo-body text-foreground max-w-[480px] line-clamp-2">{error}</p>}
      <div className="flex items-center gap-2 flex-wrap justify-center">
        {passed ? (
          <AsyncButton variant="primary" size="md" icon={<Rocket className="w-4 h-4" />} onClick={onPromote} data-testid="cs-personas-promote">{COPY.promote}</AsyncButton>
        ) : onRefine ? (
          <Button variant="primary" size="md" icon={<RefreshCw className="w-4 h-4" />} onClick={onRefine}>{t.agents.glyph_refine}</Button>
        ) : null}
        <Button variant="secondary" size="md" icon={<ScrollText className="w-4 h-4" />} onClick={onShowLog}>{COPY.testLog}</Button>
      </div>
      <div className="flex items-center gap-1 flex-wrap justify-center">
        {passed && onRefine && <Button variant="ghost" size="sm" onClick={onRefine}>{t.agents.glyph_refine}</Button>}
        {!passed && onPromoteAnyway && <Button variant="ghost" size="sm" onClick={onPromoteAnyway} data-testid="cs-personas-promote-anyway">{COPY.promoteAnyway}…</Button>}
        {onReject && <Button variant="ghost" size="sm" icon={<ThumbsDown className="w-3.5 h-3.5" />} onClick={onReject}>{COPY.reject}</Button>}
      </div>
    </div>
  );
}

export function PromotedCentre({ name, mission, starring, credits, onOpen }: { name: string; mission: string | null; starring: string[]; credits: string; onOpen: () => void }) {
  const { t } = useTranslation();
  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.97 }}
      animate={{ opacity: 1, scale: 1 }}
      transition={{ duration: 0.6, ease: EASE }}
      className="relative w-full max-w-[620px] overflow-hidden rounded-modal border border-primary/35 bg-card-bg shadow-elevation-4 px-7 py-5 flex flex-col items-center gap-2 text-center"
      style={{ backgroundImage: "radial-gradient(ellipse 80% 70% at 50% 0%, color-mix(in srgb, var(--primary) 14%, transparent), transparent 70%)" }}
    >
      <span className="typo-label text-primary uppercase">{COPY.promotedMarquee}</span>
      <TitleName name={name} />
      {mission && <p className="typo-body text-foreground max-w-[520px] line-clamp-2">{mission}</p>}
      {starring.length > 0 && (
        <p className="typo-caption">{COPY.starring} <span className="typo-title text-foreground">{starring.join(" · ")}</span></p>
      )}
      {credits && <p className="typo-caption">{credits}</p>}
      <span className="typo-title text-status-success">{t.agents.glyph_promoted_ready}</span>
      <Button variant="primary" size="md" iconRight={<ArrowRight className="w-4 h-4" />} onClick={onOpen} data-testid="cs-personas-open">{COPY.openAgent}</Button>
    </motion.div>
  );
}
