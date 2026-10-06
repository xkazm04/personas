/**
 * The reject reason, raised over the footer after R + Enter: digit-pick
 * options, 0 for the one-key skip, free text when the prompt allows it.
 */
import { motion } from 'framer-motion';
import { Button } from '@/features/shared/components/buttons';
import { DUR, EASE } from '../model';
import { Kbd } from '../parts';
import { reasonPromptOf, type DeskCtl } from '../useDesk';

export function ReasonPrompt({ ctl, reduced }: { ctl: DeskCtl; reduced: boolean }) {
  const prompt = reasonPromptOf(ctl.item);
  if (!prompt) return null;
  const short = ctl.reasonRequired && ctl.reasonText.trim().length < 12;
  return (
    <motion.div
      className="absolute inset-x-4 bottom-[76px] z-10 flex flex-col gap-3 rounded-card border border-status-error/40 bg-background p-4 shadow-elevation-3"
      initial={reduced ? { opacity: 0 } : { opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      exit={reduced ? { opacity: 0 } : { opacity: 0, y: 16 }}
      transition={{ duration: DUR.fast, ease: EASE }}
      role="group"
      aria-label={prompt.title}
      data-testid="p3-reason"
    >
      <span className="typo-heading text-foreground">{prompt.title}</span>
      {prompt.options.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {prompt.options.map((o, i) => (
            <Button key={o.id} variant="secondary" size="sm" onClick={() => ctl.pickReason(i)}>
              <span className="inline-flex items-center gap-2"><Kbd>{i + 1}</Kbd>{o.label}</span>
            </Button>
          ))}
        </div>
      )}
      {prompt.freeText && (
        <input
          autoFocus={prompt.options.length === 0}
          value={ctl.reasonText}
          onChange={(e) => ctl.setReasonText(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); ctl.submitReason(); } }}
          placeholder={prompt.placeholder ?? 'Or say it in your own words, then Enter'}
          aria-label={prompt.title}
          className="typo-body rounded-input border border-border bg-secondary/30 px-3 py-2 text-foreground"
        />
      )}
      <div className="flex items-center gap-3">
        {ctl.reasonRequired && (
          <span className={`typo-caption ${short ? 'text-status-warning' : 'text-status-success'}`}>
            {ctl.reasonText.trim().length} / 12 characters minimum
          </span>
        )}
        <span className="ml-auto flex items-center gap-2">
          <Button variant="ghost" size="sm" onClick={ctl.skipReason}>
            <span className="inline-flex items-center gap-2"><Kbd>0</Kbd>{prompt.skipLabel}</span>
          </Button>
          {prompt.freeText && (
            <Button variant="accent" tone="error" size="sm" onClick={ctl.submitReason} disabled={short}>
              <span className="inline-flex items-center gap-2"><Kbd>↵</Kbd>{ctl.item?.verdictLabels.reject}</span>
            </Button>
          )}
        </span>
      </div>
    </motion.div>
  );
}
