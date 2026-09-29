/** ComposeCentre — Scene 1. The prompt sits in the centre cell over the core
 *  of the sleeping sigil; the persona core badge and the reference context
 *  (one layer down) ride along the composer's lower edge. Enter launches. */
import { useEffect, useRef } from "react";
import { motion } from "framer-motion";
import { FileText, Rocket } from "lucide-react";
import Button from "@/features/shared/components/buttons/Button";
import { Tooltip } from "@/features/shared/components/display/Tooltip";
import { useTranslation } from "@/i18n/useTranslation";
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
  /** Push the camera into the persona core layer, grown out of its badge. */
  onOpenCore: (el: HTMLElement) => void;
  /** Quiet decision support under the composer (the recipe starters). */
  below?: React.ReactNode;
  /** A launch failure, shown inside the composer instead of a banner that
   *  would shrink the sheet. */
  error?: string | null;
  onDismissError?: () => void;
}

export function ComposeCentre({ intentText, onIntentChange, onLaunch, launchDisabled, launching, core, hasContext, onOpenContext, onOpenCore, below, error, onDismissError }: ComposeCentreProps) {
  const { t } = useTranslation();
  const ta = useRef<HTMLTextAreaElement | null>(null);
  useEffect(() => {
    const el = ta.current;
    if (!el) return;
    el.focus();
    el.selectionStart = el.value.length;
  }, []);
  const disabled = launchDisabled || launching || !intentText.trim();
  const contextLabel = hasContext ? COPY.contextAdded : COPY.context;

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.5, ease: EASE }}
      className="w-full h-full flex flex-col items-center justify-center gap-3 text-center"
    >
      <h2 className="typo-title-lg text-foreground">{COPY.heroAsk}</h2>
      <div className="@container w-full max-w-[520px] rounded-card border border-card-border bg-background/85 backdrop-blur-md px-3 pt-3 pb-2.5 text-left shadow-elevation-3 focus-within:border-[color:var(--cinema-accent)]">
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
        {/* One row: identity and context on the left, Launch on the right.
            Nothing in it shrinks or wraps. At 1280 x 800 with the nav open the
            centre cell leaves the composer ~370 px, less than the three
            labelled controls need (~430 px): the persona core badge used to
            absorb that by wrapping its label to two lines. Now the context
            control drops to its icon (the card is a size container) until the
            composer is wide enough to carry its label. */}
        <div className="flex items-center gap-2 flex-nowrap min-w-0">
          <PersonaCoreEntry core={core} locked={launching} onOpen={onOpenCore} />
          <Tooltip content={COPY.contextHint}>
            <button
              type="button"
              onClick={(e) => onOpenContext(e.currentTarget)}
              aria-label={contextLabel}
              className="inline-flex shrink-0 whitespace-nowrap items-center gap-1.5 h-8 px-2.5 rounded-interactive border border-card-border typo-body text-foreground hover:text-foreground hover:bg-foreground/5"
            >
              <FileText className="w-3.5 h-3.5 shrink-0" aria-hidden />
              <span className="hidden @[30rem]:inline">{contextLabel}</span>
              {hasContext && <span aria-hidden className="w-1.5 h-1.5 rounded-full bg-primary @[30rem]:hidden" />}
            </button>
          </Tooltip>
          <Button
            className="ml-auto shrink-0"
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
        {error && (
          <div role="alert" className="mt-2 flex items-start gap-2 rounded-input border border-status-error/25 bg-status-error/5 px-2.5 py-1.5" data-testid="sheet-cinema-launch-error">
            <span className="flex-1 min-w-0 typo-caption text-status-error break-words line-clamp-3">{error}</span>
            {onDismissError && (
              <Button variant="ghost" size="xs" onClick={onDismissError}>
                {t.errors.dismiss_error}
              </Button>
            )}
          </div>
        )}
      </div>
      {below}
    </motion.div>
  );
}
