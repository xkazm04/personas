/** ComposeCentre - Act 1: the prompt in the middle cell of the sheet.
 *
 *  One question, one textarea, one Launch. Heavier choices live one layer
 *  down: reference context inside the What frame, the persona core in its
 *  own modal, schedule / apps / events / channels in the frames around. */
import { CornerDownLeft, Paperclip } from "lucide-react";
import Button from "@/features/shared/components/buttons/Button";
import { useTranslation } from "@/i18n/useTranslation";
import { PersonaCoreEntry, type PersonaCore } from "../../personaCore";
import { COPY } from "./copy";

interface ComposeCentreProps {
  intentText: string;
  onIntentChange: (v: string) => void;
  onLaunch: () => void;
  launchDisabled: boolean;
  launching: boolean;
  hasContext: boolean;
  onOpenContext: () => void;
  core: PersonaCore;
}

export function ComposeCentre({
  intentText, onIntentChange, onLaunch, launchDisabled, launching, hasContext, onOpenContext, core,
}: ComposeCentreProps) {
  const { t } = useTranslation();
  const canLaunch = !launchDisabled && !launching && intentText.trim().length > 0;
  return (
    <div className="flex flex-col items-center gap-4 w-full">
      <h1 className="typo-heading-lg text-foreground text-center">{COPY.heroTitle}</h1>
      <div className="w-full max-w-[560px] rounded-card border border-card-border bg-card-bg shadow-elevation-3 p-3 flex flex-col gap-2 transition-colors focus-within:border-primary/40">
        <label htmlFor="cs-personas-intent" className="sr-only">{COPY.composerLabel}</label>
        <textarea
          id="cs-personas-intent"
          autoFocus
          rows={3}
          value={intentText}
          onChange={(e) => onIntentChange(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
              e.preventDefault();
              if (canLaunch) onLaunch();
            }
          }}
          placeholder={t.agents.glyph_intent_placeholder}
          className="w-full resize-none bg-transparent border-0 outline-none typo-body-lg text-foreground placeholder:text-muted"
          data-testid="cs-personas-intent"
        />
        <div className="flex items-center gap-2 flex-wrap">
          <Button
            variant="ghost"
            size="sm"
            icon={<Paperclip className="w-3.5 h-3.5" />}
            onClick={onOpenContext}
            className={hasContext ? "text-primary" : undefined}
          >
            {hasContext ? COPY.contextChipSet : COPY.contextChip}
          </Button>
          <PersonaCoreEntry core={core} />
          <span className="ml-auto typo-caption hidden sm:inline">{COPY.composerHint}</span>
          <Button
            variant="primary"
            size="md"
            onClick={onLaunch}
            disabled={!canLaunch}
            loading={launching}
            loadingLabel={COPY.launching}
            iconRight={<CornerDownLeft className="w-3.5 h-3.5" />}
            data-testid="cs-personas-launch"
          >
            {t.agents.glyph_launch}
          </Button>
        </div>
      </div>
    </div>
  );
}
