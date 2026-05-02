import { useState } from "react";
import { motion } from "framer-motion";
import { HelpCircle, Send, X } from "lucide-react";
import { DIM_META } from "@/features/shared/glyph";
import type { BuildQuestion } from "@/lib/types/buildTypes";
import { VaultConnectorPicker } from "@/features/shared/components/picker/VaultConnectorPicker";
import { useSystemStore } from "@/stores/systemStore";
import { CELL_KEY_TO_DIM, DIM_LABEL } from "./glyphLayoutHelpers";

interface GlyphAnswerCardProps {
  question: BuildQuestion;
  onAnswer: (cellKey: string, answer: string) => void;
  onClose: () => void;
}

/** Refine-phase popover: floats above the sigil with no scrim and adopts
 *  the active dimension's colour for its border/shadow so the user always
 *  knows which leaf they're answering. Auto-closes on submit so the petal
 *  visibly "turns off" — the user gets immediate feedback that the
 *  dimension is resolved before the next pending one auto-focuses. */
export function GlyphAnswerCard({ question, onAnswer, onClose }: GlyphAnswerCardProps) {
  const [text, setText] = useState("");
  const dim = CELL_KEY_TO_DIM[question.cellKey];
  const color = dim ? DIM_META[dim].color : "#60a5fa";
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
      // The card sits on top of the live glyph (orbit, petal sweep,
      // pulsing pending leaves). `bg-card-bg` is ~5% opacity by design —
      // fine for cards in normal layout flow, but unreadable as an
      // overlay against the animated content below. Use `bg-background`
      // at 95% + a moderate backdrop-blur so anything still visible
      // through the seam is softened, not distracting.
      className="relative rounded-modal bg-background/95 backdrop-blur-md p-4 flex flex-col gap-3"
      style={{
        border: `1px solid ${color}55`,
        boxShadow: `0 0 32px ${color}44, 0 8px 28px rgba(0,0,0,0.55)`,
      }}
    >
      <div
        className="absolute top-0 left-0 w-full h-1 rounded-t-modal"
        style={{ background: `linear-gradient(90deg, ${color}, transparent)` }}
      />
      <div className="flex items-center gap-2">
        <span
          className="w-7 h-7 rounded-md flex items-center justify-center"
          style={{ background: `${color}33`, boxShadow: `0 0 10px ${color}66` }}
        >
          <HelpCircle className="w-4 h-4 text-foreground" />
        </span>
        <span className="typo-label font-bold uppercase tracking-[0.18em] text-foreground/70 flex-1">
          {dim ? DIM_LABEL[dim] : question.cellKey.replace(/-/g, " ")}
        </span>
        <button
          type="button"
          onClick={onClose}
          className="text-foreground/40 hover:text-foreground/80"
          aria-label="Close"
        >
          <X className="w-4 h-4" />
        </button>
      </div>
      <p className="typo-body-lg text-foreground leading-snug">{question.question}</p>
      {category ? (
        <VaultConnectorPicker
          category={category}
          value=""
          onChange={(serviceType) => submit(serviceType)}
          onAddFromCatalog={() => useSystemStore.getState().setSidebarSection("credentials")}
        />
      ) : (
        <>
          {options.length > 0 && (
            <div className="flex flex-wrap gap-2">
              {options.map((opt, i) => (
                <button
                  key={i}
                  type="button"
                  onClick={() => submit(opt)}
                  className="px-2.5 py-1.5 rounded-full bg-primary/10 hover:bg-primary/20 border typo-body text-foreground transition-colors cursor-pointer"
                  style={{ borderColor: `${color}40` }}
                >
                  {opt}
                </button>
              ))}
            </div>
          )}
          <div className="flex items-center gap-2">
            <input
              type="text"
              value={text}
              onChange={(e) => setText(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") submit(text); }}
              placeholder="Answer in your own words…"
              className="flex-1 px-3 py-2 rounded-modal bg-primary/5 border typo-body text-foreground placeholder:text-foreground/40 focus:outline-none"
              style={{ borderColor: `${color}40` }}
              autoFocus
            />
            <button
              type="button"
              onClick={() => submit(text)}
              disabled={!text.trim()}
              className="px-3 py-2 rounded-modal border typo-body text-foreground disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer flex items-center gap-1.5 transition-colors"
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
