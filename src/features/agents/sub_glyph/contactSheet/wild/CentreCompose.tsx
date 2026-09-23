/** CentreCompose: Scene 1. The brief sits in the centre frame of the sheet.
 *  The intent box, one door down to reference notes, the Persona Core badge
 *  (its own modal), and the launch. Enter rolls the camera, Shift+Enter breaks
 *  a line. */
import { motion } from "framer-motion";
import { Clapperboard, FileText } from "lucide-react";
import { PersonaCoreEntry } from "../../personaCore";
import type { PersonaCore } from "../../personaCore";
import { COPY } from "./wildCopy";

interface CentreComposeProps {
  intentText: string;
  onIntentChange: (v: string) => void;
  onLaunch: () => void;
  launchDisabled: boolean;
  hasNotes: boolean;
  onOpenNotes: () => void;
  core: PersonaCore;
}

export function CentreCompose({ intentText, onIntentChange, onLaunch, launchDisabled, hasNotes, onOpenNotes, core }: CentreComposeProps) {
  const disabled = launchDisabled || !intentText.trim();
  return (
    <motion.div
      key="compose"
      className="flex flex-col items-center gap-3 w-full"
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -10 }}
      transition={{ duration: 0.5, ease: [0.2, 0.7, 0.2, 1] }}
    >
      <span className="csw-edge">{COPY.compose.eyebrow}</span>
      <h2 className="csw-display m-0" style={{ fontSize: "clamp(26px, 2.6vw, 38px)", lineHeight: 1.05, textTransform: "uppercase" }}>
        {COPY.compose.hero}
      </h2>
      <div className="csw-composer">
        <textarea
          value={intentText}
          onChange={(e) => onIntentChange(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              if (!disabled) onLaunch();
            }
          }}
          placeholder={COPY.compose.placeholder}
          aria-label={COPY.compose.hero}
          autoFocus
        />
        <div className="flex items-center gap-2 flex-wrap mt-1">
          <button type="button" className="csw-ghost" onClick={onOpenNotes} aria-pressed={hasNotes}>
            <FileText className="w-4 h-4" style={{ color: hasNotes ? "var(--cs-amber)" : undefined }} />
            {hasNotes ? COPY.compose.contextSet : COPY.compose.context}
          </button>
          <PersonaCoreEntry core={core} locked={false} />
          <button type="button" className="csw-btn ml-auto" onClick={onLaunch} disabled={disabled}>
            <Clapperboard className="w-4 h-4" />
            {COPY.compose.launch}
            <span className="csw-kbd">↵</span>
          </button>
        </div>
      </div>
      <span className="csw-edge" style={{ color: "var(--cs-faint)", letterSpacing: ".06em", textTransform: "none" }}>{COPY.compose.hint}</span>
    </motion.div>
  );
}
