// TriageFocusOptions — the inner carousel: one decision option at a time, a
// verdict-coloured dot strip, and auto-advance to the next undecided one.
//
// This is the half of the donor flow the Monitor's modal never had. An item
// that carries several options (`TriageItem.decisions`) is not one verdict but
// N, and the donor's answer — focus one, decide it, slide to the next, commit
// the parent when the last one lands — is the reason the operator judged it the
// better surface.
//
// The dot strip is the progress bar AND the index: a dot wears the verdict
// recorded on its option, so a reviewer three deep can see what they already
// said without going back.
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import { Check, ChevronLeft, ChevronRight, X } from 'lucide-react';

import Button from '@/features/shared/components/buttons/Button';
import { Tooltip } from '@/features/shared/components/display/Tooltip';
import { MarkdownRenderer } from '@/features/shared/components/editors/MarkdownRenderer';
import { TONE_FILL, TONE_TEXT, type TriageDecisionOption } from '@/features/shared/triage/triageFocusBridge';
import { useTranslation } from '@/i18n/useTranslation';

import { OPTION_SPRING, OPTION_VARIANTS, STILL_SPRING, STILL_VARIANTS } from './triageFocusMotion';
import type { OptionVerdict } from './useTriageFocus';

const VIDEO_EXT = /\.(mp4|webm|mov|avi|mkv|ogv)(\?.*)?$/i;

/** The first media reference an option carries, in the donor's precedence. */
export function optionMedia(option: TriageDecisionOption): string | null {
  return option.image_url || option.gallery_image_ref || option.preview_url || null;
}

function OptionMedia({ url, alt }: { url: string; alt: string }) {
  if (VIDEO_EXT.test(url)) {
    // `key={url}` is load-bearing, not decoration: a <video> keeps currentTime,
    // readyState and buffered ranges across a src swap, so the carousel sliding
    // from one option's clip to the next would resume the new one at the old
    // one's playhead. The key forces a teardown (census
    // `media-element-src-without-remount-key`).
    return (
      <video key={url} src={url} controls className="max-h-[320px] w-full object-contain" aria-label={alt} />
    );
  }
  return (
    <img src={url} alt={alt} loading="lazy" className="max-h-[320px] w-full object-contain" />
  );
}

/** The verdict a dot wears. Tone vocabulary only — no `bg-emerald-400`. */
function dotClass(verdict: OptionVerdict | undefined, isCurrent: boolean): string {
  if (verdict === 'accept') return TONE_FILL.success;
  if (verdict === 'reject') return TONE_FILL.danger;
  return isCurrent ? TONE_FILL.accent : 'bg-foreground/20';
}

export function TriageFocusOptionStrip({
  options, index, verdicts, onSelect, onPrev, onNext, onClear, decidedCount,
}: {
  options: readonly TriageDecisionOption[];
  index: number;
  verdicts: Record<string, OptionVerdict>;
  onSelect: (i: number) => void;
  onPrev: () => void;
  onNext: () => void;
  onClear: () => void;
  decidedCount: number;
}) {
  const { t, tx } = useTranslation();
  const m = t.monitor;
  return (
    <div className="flex flex-wrap items-center gap-2">
      <span className="typo-label text-foreground">
        {tx(m.triage_focus_option_position, { current: index + 1, total: options.length })}
      </span>
      <Tooltip content={m.triage_focus_option_prev}>
        <Button variant="ghost" size="icon-sm" onClick={onPrev} disabled={index === 0} aria-label={m.triage_focus_option_prev}>
          <ChevronLeft className="h-3.5 w-3.5" />
        </Button>
      </Tooltip>
      <div className="flex items-center gap-1">
        {options.map((option, i) => (
          <Tooltip key={option.id} content={tx(m.triage_focus_option_select, { position: i + 1 })}>
            <Button
              variant="ghost"
              size="icon-sm"
              onClick={() => onSelect(i)}
              aria-label={tx(m.triage_focus_option_select, { position: i + 1 })}
              aria-current={i === index}
              className="!w-5 !h-5 !p-0"
            >
              <span className={`block h-2 w-2 rounded-full transition-transform ${dotClass(verdicts[option.id], i === index)} ${i === index ? 'scale-125' : ''}`} />
            </Button>
          </Tooltip>
        ))}
      </div>
      <Tooltip content={m.triage_focus_option_next}>
        <Button variant="ghost" size="icon-sm" onClick={onNext} disabled={index >= options.length - 1} aria-label={m.triage_focus_option_next}>
          <ChevronRight className="h-3.5 w-3.5" />
        </Button>
      </Tooltip>
      {decidedCount > 0 && (
        <Tooltip content={m.triage_focus_clear_hint}>
          <Button variant="ghost" size="xs" onClick={onClear}>{m.triage_focus_clear}</Button>
        </Tooltip>
      )}
    </div>
  );
}

export function TriageFocusOptionCard({
  option, verdict, onDecide, direction,
}: {
  option: TriageDecisionOption;
  verdict: OptionVerdict | undefined;
  onDecide: (v: OptionVerdict) => void;
  direction: number;
}) {
  const { t } = useTranslation();
  const m = t.monitor;
  const still = useReducedMotion();
  const media = optionMedia(option);

  return (
    <AnimatePresence mode="wait" custom={direction}>
      <motion.div
        key={option.id}
        custom={direction}
        variants={still ? STILL_VARIANTS : OPTION_VARIANTS}
        initial="enter"
        animate="center"
        exit="exit"
        transition={still ? STILL_SPRING : OPTION_SPRING}
        className="rounded-card border border-primary/12 bg-secondary/25"
        data-testid="triage-focus-option"
      >
        {media && (
          <div className="flex items-center justify-center overflow-hidden rounded-t-card bg-secondary/40">
            <OptionMedia url={media} alt={option.label} />
          </div>
        )}
        <div className="space-y-2 p-4">
          <div className="flex items-start gap-3">
            <div className="min-w-0 flex-1">
              {option.category && (
                <span className={`typo-caption ${TONE_TEXT.accent}`}>{option.category}</span>
              )}
              <h3 className="typo-body-lg text-foreground">{option.label}</h3>
            </div>
            <div className="flex flex-shrink-0 items-center gap-1.5">
              <Button
                variant={verdict === 'reject' ? 'accent' : 'ghost'}
                tone={verdict === 'reject' ? 'error' : undefined}
                size="sm"
                aria-pressed={verdict === 'reject'}
                onClick={() => onDecide('reject')}
                icon={<X className="h-3.5 w-3.5" />}
                data-testid="triage-focus-option-reject"
              >
                {m.triage_focus_option_reject}
              </Button>
              <Button
                variant={verdict === 'accept' ? 'accent' : 'ghost'}
                tone={verdict === 'accept' ? 'success' : undefined}
                size="sm"
                aria-pressed={verdict === 'accept'}
                onClick={() => onDecide('accept')}
                icon={<Check className="h-3.5 w-3.5" />}
                data-testid="triage-focus-option-accept"
              >
                {m.triage_focus_option_accept}
              </Button>
            </div>
          </div>
          {option.description && (
            <MarkdownRenderer content={option.description} className="typo-body text-foreground" />
          )}
        </div>
      </motion.div>
    </AnimatePresence>
  );
}
