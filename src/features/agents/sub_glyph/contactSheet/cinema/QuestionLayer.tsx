/** QuestionLayer — the inside of a frame the camera pushed into for a question.
 *  Number keys pick an option, Enter moves on, Backspace goes back; a pick is
 *  only a draft here, nothing reaches the build until "Send answers". Connector
 *  questions use the real vault picker, filtered by the question's category. */
import { useEffect, useMemo, useRef } from "react";
import { motion } from "framer-motion";
import { ArrowLeft, ArrowRight } from "lucide-react";
import type { GlyphDimension } from "@/features/shared/glyph";
import { DIM_META } from "@/features/shared/glyph";
import type { BuildQuestion } from "@/lib/types/buildTypes";
import { VaultConnectorPicker } from "@/features/vault/components/VaultConnectorPicker";
import Button from "@/features/shared/components/buttons/Button";
import { colorWithAlpha } from "@/lib/utils/colorWithAlpha";
import { frameNumber } from "./sheetModel";
import { COPY } from "./copy";

interface QuestionLayerProps {
  question: BuildQuestion;
  dim: GlyphDimension | null;
  label: string;
  index: number;
  total: number;
  draft: string;
  onDraft: (v: string) => void;
  onPick: (v: string) => void;
  onNext: () => void;
  onPrev: () => void;
}

const isTyping = (el: EventTarget | null) =>
  el instanceof HTMLElement && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.isContentEditable);

export function QuestionLayer({ question, dim, label, index, total, draft, onDraft, onPick, onNext, onPrev }: QuestionLayerProps) {
  const color = dim ? DIM_META[dim].color : "#60a5fa";
  const options = useMemo(() => question.options ?? [], [question.options]);
  const isLast = index >= total - 1;
  const firstOpt = useRef<HTMLButtonElement | null>(null);
  const freeText = options.includes(draft) ? "" : draft;

  useEffect(() => {
    const h = window.setTimeout(() => firstOpt.current?.focus(), 260);
    return () => window.clearTimeout(h);
  }, [question]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.metaKey || e.altKey || isTyping(e.target)) return;
      if (/^[1-9]$/.test(e.key)) {
        const opt = options[Number(e.key) - 1];
        if (opt !== undefined) { e.preventDefault(); onPick(opt); }
      } else if (e.key === "Enter" && draft.trim() && !(e.target instanceof HTMLButtonElement)) {
        e.preventDefault();
        onNext();
      } else if (e.key === "Backspace" && index > 0) {
        e.preventDefault();
        onPrev();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [options, draft, index, onPick, onNext, onPrev]);

  return (
    <div className="flex-1 flex flex-col justify-center gap-4 max-w-[560px] w-full mx-auto">
      <div className="flex items-center gap-2.5 typo-caption pr-10">
        <span className="font-mono" style={{ color }}>{dim ? frameNumber(dim) : "--"}</span>
        <span className="font-semibold uppercase tracking-[0.12em]" style={{ color }}>{label}</span>
        <span className="ml-auto font-mono text-foreground">{COPY.questionOf(index + 1, total)}</span>
      </div>
      <motion.h2
        key={question.question}
        initial={{ opacity: 0, y: 6 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.18, duration: 0.3 }}
        className="typo-heading-lg font-semibold text-foreground leading-snug"
      >
        {question.question}
      </motion.h2>

      {question.connectorCategory ? (
        <VaultConnectorPicker category={question.connectorCategory} value={draft} onChange={onPick} suggested={question.suggested} />
      ) : (
        <div className="flex flex-col gap-1.5" role="radiogroup" aria-label={question.question}>
          {options.map((opt, i) => {
            const on = draft === opt;
            return (
              <button
                key={opt}
                ref={i === 0 ? firstOpt : undefined}
                type="button"
                role="radio"
                aria-checked={on}
                onClick={() => onPick(opt)}
                className="flex items-center gap-3 min-h-[42px] px-3 py-2 rounded-input border text-left typo-body text-foreground transition-colors"
                style={{ borderColor: on ? color : "var(--card-border, rgba(255,255,255,0.1))", background: on ? colorWithAlpha(color, 0.12) : undefined }}
              >
                <span
                  className="w-[22px] h-[22px] rounded-[5px] grid place-items-center typo-caption font-mono flex-shrink-0 border"
                  style={on ? { background: color, borderColor: color, color: "#0b1220" } : { borderColor: "var(--card-border, rgba(255,255,255,0.1))" }}
                >
                  {i + 1}
                </span>
                <span>{opt}</span>
              </button>
            );
          })}
        </div>
      )}

      {!question.connectorCategory && (
        <input
          type="text"
          value={freeText}
          onChange={(e) => onDraft(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter" && draft.trim()) { e.preventDefault(); onNext(); } }}
          placeholder={COPY.ownWords}
          aria-label={COPY.ownWords}
          className="h-10 px-3 rounded-input border border-card-border bg-transparent typo-body text-foreground outline-none focus:border-foreground/30"
        />
      )}

      <div className="flex items-center justify-between pt-1">
        {index > 0 ? (
          <Button variant="ghost" size="sm" icon={<ArrowLeft className="w-3.5 h-3.5" />} onClick={onPrev}>{COPY.prev}</Button>
        ) : <span />}
        <Button variant="primary" size="md" iconRight={<ArrowRight className="w-3.5 h-3.5" />} disabled={!draft.trim()} onClick={onNext}>
          {isLast ? COPY.reviewAnswers : COPY.next}
        </Button>
      </div>
    </div>
  );
}
