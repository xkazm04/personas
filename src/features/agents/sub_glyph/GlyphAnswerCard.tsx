import { useState } from "react";
import { motion } from "framer-motion";
import { HelpCircle, Send, X } from "lucide-react";
import { DIM_META } from "@/features/shared/glyph";
import type { BuildQuestion } from "@/lib/types/buildTypes";
import { VaultConnectorPicker } from "@/features/vault/components/VaultConnectorPicker";
import { CELL_KEY_TO_DIM, DIM_LABEL } from "./glyphLayoutHelpers";
import { useTranslation } from "@/i18n/useTranslation";


interface GlyphAnswerCardProps {
  question: BuildQuestion;
  onAnswer: (cellKey: string, answer: string) => void;
  onClose: () => void;
  /** "sigil" (default) floats over the glyph as a rounded popover; "dialogue"
   *  renders it as a flush, left-aligned, square-cornered conversation turn for
   *  the Dialogue surface (readability-first). */
  variant?: "sigil" | "dialogue";
}

/** Refine-phase popover: floats above the sigil with no scrim and adopts
 *  the active dimension's colour for its border/shadow so the user always
 *  knows which leaf they're answering. Auto-closes on submit so the petal
 *  visibly "turns off" — the user gets immediate feedback that the
 *  dimension is resolved before the next pending one auto-focuses. */
export function GlyphAnswerCard({ question, onAnswer, onClose, variant = "sigil" }: GlyphAnswerCardProps) {
  const { t } = useTranslation();
  const [text, setText] = useState("");
  const dim = CELL_KEY_TO_DIM[question.cellKey];
  const color = dim ? DIM_META[dim].color : "#60a5fa";
  const dlg = variant === "dialogue";
  const options = question.options ?? [];
  const category = question.connectorCategory ?? null;
  const submit = (v: string) => {
    const trimmed = v.trim();
    if (!trimmed) return;
    onAnswer(question.cellKey, trimmed);
    setText("");
    onClose();
  };
  return (
    <motion.div
      initial={{ opacity: 0, y: 12, scale: 0.96 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, y: 12, scale: 0.96 }}
      transition={{ duration: 0.22, ease: [0.16, 1, 0.3, 1] }}
      // Centered overlay inside the sigil canvas. Earlier each question
      // sized to its content (a 2-option Yes/No card was ~280px while a
      // free-text card was ~440px), making the questionnaire feel
      // jittery as the user advanced. Lock to 600px (or viewport-cap)
      // so width is consistent regardless of question shape.
      className={
        dlg
          ? "relative bg-card-bg p-5 flex flex-col gap-4 w-full text-left"
          : "relative rounded-modal bg-background/95 backdrop-blur-md p-4 flex flex-col gap-3 w-[min(600px,90vw)]"
      }
      style={{
        border: `1px solid ${color}${dlg ? "40" : "55"}`,
        borderLeft: dlg ? `3px solid ${color}` : undefined,
        boxShadow: dlg ? "none" : `0 0 32px ${color}44, 0 8px 28px rgba(0,0,0,0.55)`,
      }}
    >
      {!dlg && (
        <div
          className="absolute top-0 left-0 w-full h-1 rounded-t-modal"
          style={{ background: `linear-gradient(90deg, ${color}, transparent)` }}
        />
      )}
      <div className="flex items-center gap-2">
        <span
          className="w-7 h-7 rounded-input flex items-center justify-center"
          style={{ background: `${color}33`, boxShadow: `0 0 10px ${color}66` }}
        >
          <HelpCircle className="w-4 h-4 text-foreground" />
        </span>
        <span className="typo-label font-bold uppercase tracking-[0.18em] text-foreground flex-1">
          {dim ? DIM_LABEL[dim] : question.cellKey.replace(/-/g, " ")}
        </span>
        <button
          type="button"
          onClick={onClose}
          className="text-foreground hover:text-foreground/80"
          aria-label="Close"
        >
          <X className="w-4 h-4" />
        </button>
      </div>
      <p className={dlg ? "typo-title-sm text-foreground text-left leading-relaxed" : "typo-body-lg text-foreground leading-snug"}>{question.question}</p>
      {category ? (
        <VaultConnectorPicker
          category={category}
          value=""
          onChange={(serviceType) => submit(serviceType)}
          suggested={question.suggested}
        />
      ) : (
        <>
          {options.length > 0 && (
            <div className={dlg ? "flex flex-col gap-2 items-start" : "flex flex-wrap gap-2"}>
              {options.map((opt, i) => (
                <button
                  key={i}
                  type="button"
                  onClick={() => submit(opt)}
                  className={`border typo-body text-foreground transition-colors cursor-pointer bg-primary/10 hover:bg-primary/20 ${dlg ? "w-full text-left px-3.5 py-2.5 rounded-none" : "px-2.5 py-1.5 rounded-full"}`}
                  style={{ borderColor: `${color}40` }}
                >
                  {opt}
                </button>
              ))}
            </div>
          )}
          <div className="flex items-stretch gap-2">
            <input
              type="text"
              value={text}
              onChange={(e) => setText(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") submit(text); }}
              placeholder={t.templates.chronology.answer_own_words_placeholder}
              className={`flex-1 bg-primary/5 border text-foreground placeholder:text-foreground/40 focus:outline-none ${dlg ? "px-3.5 py-3 rounded-none typo-body-lg text-left" : "px-3 py-2 rounded-modal typo-body"}`}
              style={{ borderColor: `${color}40` }}
              autoFocus
            />
            <button
              type="button"
              onClick={() => submit(text)}
              disabled={!text.trim()}
              className={`border typo-body text-foreground disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer flex items-center gap-1.5 transition-colors ${dlg ? "px-4 rounded-none" : "px-3 py-2 rounded-modal"}`}
              style={{
                background: `${color}33`,
                borderColor: `${color}66`,
              }}
            >
              <Send className="w-3.5 h-3.5" />
              Send
            </button>
          </div>
        </>
      )}
    </motion.div>
  );
}
