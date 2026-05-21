import { useState } from "react";
import { motion } from "framer-motion";
import { RefreshCw } from "lucide-react";
import { debtText } from '@/i18n/DebtText';


interface GlyphRefineComposerProps {
  onSubmit: (v: string) => void;
  onCancel: () => void;
  /** Pre-populate the textarea — used by Phase 5b's "Split via Refine"
   *  affordance so the user starts with a structured prompt asking the
   *  LLM to divide a specific capability. The user can still edit
   *  before submitting. */
  initialText?: string;
}

export function GlyphRefineComposer({ onSubmit, onCancel, initialText }: GlyphRefineComposerProps) {
  const [text, setText] = useState(initialText ?? "");
  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: 8 }}
      // Glass material — the composer mounts INSIDE the test-complete card
      // which itself sits on bg-background/95. Earlier the textarea used
      // bg-primary/5 (mostly transparent) and visually collided with the
      // status text + capability list underneath. Wrapping in an opaque
      // glass surface gives the composer its own visual layer so the
      // collision goes away.
      className="w-full flex flex-col gap-2 pointer-events-auto rounded-modal border border-primary/25 bg-background/85 backdrop-blur-xl shadow-elevation-2 px-3 py-2.5"
    >
      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder={debtText("auto_tell_the_agent_what_to_change_b0741749")}
        rows={3}
        autoFocus
        className="w-full px-3 py-2 rounded-modal bg-foreground/5 border border-primary/20 typo-body text-foreground placeholder:text-foreground/40 resize-none focus:outline-none focus:border-primary/60"
      />
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={() => { const v = text.trim(); if (v) onSubmit(v); }}
          disabled={!text.trim()}
          className="flex-1 px-3 py-1.5 rounded-full bg-primary/25 hover:bg-primary/40 border border-primary/40 typo-body text-foreground disabled:opacity-40 cursor-pointer flex items-center justify-center gap-1.5"
        >
          <RefreshCw className="w-3.5 h-3.5" />
          Refine
        </button>
        <button
          type="button"
          onClick={onCancel}
          className="px-3 py-1.5 rounded-full border border-border/40 hover:border-foreground/30 typo-body text-foreground"
        >
          Cancel
        </button>
      </div>
    </motion.div>
  );
}
