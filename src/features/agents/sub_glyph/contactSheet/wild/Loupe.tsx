/** Loupe: the inner layer the camera pushes into.
 *
 *  It grows out of the frame's own position on the sheet (same transform
 *  origin as the camera move), wearing a strip of film base as its header with
 *  the frame's edge code, and shrinks back into the frame on the way out. Esc
 *  or the back control pulls out. Also hosts the three centre-frame pages:
 *  reference notes, refine, and the prints (capability review). */
import type { ReactNode } from "react";
import { motion, useReducedMotion } from "framer-motion";
import { ArrowLeft } from "lucide-react";
import { GlyphRefineComposer } from "../../GlyphRefineComposer";
import { GlyphCapabilityPreview } from "../../GlyphCapabilityPreview";
import { COPY } from "./wildCopy";

interface LoupeProps {
  origin: string;
  edge: string;
  title: string;
  accent?: string;
  onClose: () => void;
  children: ReactNode;
}

export function Loupe({ origin, edge, title, accent, onClose, children }: LoupeProps) {
  const reduce = useReducedMotion();
  return (
    <motion.section
      className="csw-loupe"
      role="region"
      aria-label={title}
      style={{ transformOrigin: origin }}
      initial={reduce ? { opacity: 0 } : { opacity: 0, scale: 0.34, filter: "blur(6px)" }}
      animate={{ opacity: 1, scale: 1, filter: "blur(0px)" }}
      exit={reduce ? { opacity: 0 } : { opacity: 0, scale: 0.34, filter: "blur(6px)" }}
      transition={{ duration: 0.55, ease: [0.25, 0.8, 0.25, 1], delay: reduce ? 0 : 0.12 }}
    >
      <header className="csw-loupe-h">
        <button type="button" className="csw-ghost" style={{ color: "#f2ebe0", borderColor: "rgba(255,236,210,.25)" }} onClick={onClose} aria-label={COPY.loupe.back}>
          <ArrowLeft className="w-4 h-4" />
          <span className="csw-kbd" style={{ color: "#f2ebe0", borderColor: "rgba(255,236,210,.3)" }}>{COPY.loupe.esc}</span>
        </button>
        <span className="csw-edge">{edge}</span>
        <h3 className="csw-display m-0 truncate" style={{ fontSize: 24, textTransform: "uppercase", color: accent ?? "#f2ebe0" }}>{title}</h3>
        <span className="csw-edge ml-auto hidden md:inline" style={{ color: "rgba(240,165,90,.6)" }}>{COPY.stock}</span>
      </header>
      <div className="csw-loupe-b">{children}</div>
    </motion.section>
  );
}

export function LoupeNotes({ value, onChange }: { value: string; onChange?: (v: string) => void }) {
  return (
    <div className="flex flex-col gap-3 max-w-[820px] mx-auto">
      <p className="csw-body m-0">{COPY.loupe.notesBody}</p>
      <textarea
        className="csw-area"
        value={value}
        onChange={(e) => onChange?.(e.target.value)}
        placeholder={COPY.loupe.notesPh}
        aria-label={COPY.loupe.notesTitle}
        disabled={!onChange}
        autoFocus
      />
    </div>
  );
}

export function LoupeRefine({ prefill, onSubmit, onCancel }: { prefill: string | null; onSubmit: (v: string) => void; onCancel: () => void }) {
  return (
    <div className="max-w-[760px] mx-auto">
      <GlyphRefineComposer initialText={prefill ?? undefined} onSubmit={onSubmit} onCancel={onCancel} />
    </div>
  );
}

export function LoupePrints({ onRequestSplit }: { onRequestSplit: (title: string, prompt: string) => void }) {
  return (
    <div className="flex flex-col gap-3 max-w-[900px] mx-auto">
      <p className="csw-body m-0">{COPY.loupe.printsBody}</p>
      <GlyphCapabilityPreview onRequestSplit={onRequestSplit} />
    </div>
  );
}
