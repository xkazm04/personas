/** ComposeCentre — Scene 1. The prompt sits in the centre cell over the core
 *  of the sleeping sigil; the persona core badge and the reference context
 *  (one layer down) ride along the composer's lower edge. Enter launches. */
import { useEffect, useRef } from "react";
import { motion } from "framer-motion";
import { FileText, Rocket } from "lucide-react";
import Button from "@/features/shared/components/buttons/Button";
import { PersonaCoreEntry, type PersonaCore } from "@/features/agents/sub_glyph/personaCore";
import { EASE } from "../cinemaMotion";
import { COPY } from "../copy";

interface ComposeCentreProps {
  intentText: string;
  onIntentChange: (v: string) => void;
  onLaunch: () => void;
  launchDisabled: boolean;
  launching: boolean;
  core: PersonaCore;
  hasContext: boolean;
  onOpenContext: (el: HTMLElement) => void;
  /** Quiet decision support under the composer (the recipe starters). */
  below?: React.ReactNode;
}

export function ComposeCentre({ intentText, onIntentChange, onLaunch, launchDisabled, launching, core, hasContext, onOpenContext, below }: ComposeCentreProps) {
  const ta = useRef<HTMLTextAreaElement | null>(null);
  useEffect(() => {
    const el = ta.current;
    if (!el) return;
    el.focus();
    el.selectionStart = el.value.length;
  }, []);
  const disabled = launchDisabled || launching || !intentText.trim();

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.5, ease: EASE }}
      className="w-full h-full flex flex-col items-center justify-center gap-3 text-center"
    >
      <h1 className="typo-title-lg text-foreground">{COPY.heroAsk}</h1>
      <div className="w-full max-w-[520px] rounded-card border border-card-border bg-background/85 backdrop-blur-md px-3 pt-3 pb-2.5 text-left shadow-elevation-3 focus-within:border-[color:var(--cinema-accent)]">
        <label htmlFor="sheet-cinema-intent" className="sr-only">{COPY.heroAsk}</label>
        <textarea
          id="sheet-cinema-intent"
          data-testid="agent-intent-input"
          ref={ta}
          rows={3}
          value={intentText}
          onChange={(e) => onIntentChange(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
              e.preventDefault();
              if (!disabled) onLaunch();
            }
          }}
          placeholder={COPY.placeholder}
          className="w-full min-h-[64px] resize-none bg-transparent outline-none typo-body-lg text-foreground placeholder:text-foreground/35 leading-relaxed"
        />
        <div className="flex items-center gap-2 flex-wrap">
          <PersonaCoreEntry core={core} locked={launching} />
          <button
            type="button"
            onClick={(e) => onOpenContext(e.currentTarget)}
            className="inline-flex items-center gap-1.5 h-8 px-2.5 rounded-interactive border border-card-border typo-body text-foreground hover:text-foreground hover:bg-foreground/5"
          >
            <FileText className="w-3.5 h-3.5" />
            {hasContext ? COPY.contextAdded : COPY.context}
          </button>
          <span className="ml-auto typo-caption text-foreground">{COPY.buildRange}</span>
          <Button
            variant="primary"
            size="md"
            icon={<Rocket className="w-3.5 h-3.5" />}
            onClick={onLaunch}
            disabled={disabled}
            loading={launching}
            loadingLabel={COPY.launching}
            data-testid="agent-launch-btn"
          >
            {COPY.launch}
            <kbd className="ml-1 font-mono typo-caption opacity-70">↵</kbd>
          </Button>
        </div>
      </div>
      {below}
    </motion.div>
  );
}
