// DeckActionBar — the pointer half of the same vocabulary the keyboard uses.
//
// Two surfaces, one grammar. `DeckFlank` is the wide-window affordance: two
// oversized targets sitting exactly where the card is about to be thrown, so
// the mouse gesture and the drag gesture point the same way. Below ~lg they
// disappear and the compact row carries everything, which is also the only row
// that can hold branches and skip.
//
// Branch buttons render their digit. That is the whole hotkey documentation:
// arrows decide, numbers branch, and a reviewer learns it by looking once.
import { motion } from 'framer-motion';
import { ArrowLeft, ArrowRight, SkipForward, ThumbsDown, ThumbsUp } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';

import { useTranslation } from '@/i18n/useTranslation';

import type { TriageItem, TriageTone, TriageVerdict } from '../triageTypes';
import { Kbd, TONE_CHIP, TONE_HOVER } from './DeckChips';

export function DeckFlank({
  tone,
  icon: Icon,
  label,
  disabled,
  onClick,
}: {
  tone: Extract<TriageTone, 'success' | 'danger'>;
  icon: LucideIcon;
  label: string;
  disabled?: boolean;
  onClick: () => void;
}) {
  return (
    <motion.button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      title={label}
      whileHover={{ scale: 1.06 }}
      whileTap={{ scale: 0.94 }}
      className={`focus-ring hidden h-16 w-16 shrink-0 items-center justify-center rounded-full border-2 shadow-elevation-2 transition-colors disabled:is-disabled lg:flex ${TONE_CHIP[tone]} ${TONE_HOVER[tone]}`}
    >
      <Icon className="h-7 w-7" aria-hidden />
    </motion.button>
  );
}

function ActionButton({
  tone,
  icon: Icon,
  label,
  disabled,
  onClick,
}: {
  tone: TriageTone;
  icon: LucideIcon;
  label: string;
  disabled?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      title={label}
      className={`focus-ring inline-flex items-center gap-2 rounded-interactive border px-4 py-2 typo-body font-medium transition-colors disabled:is-disabled ${TONE_CHIP[tone]} ${TONE_HOVER[tone]}`}
    >
      <Icon className="h-4 w-4 shrink-0" aria-hidden />
      {label}
    </button>
  );
}

export function DeckActionBar({
  item,
  canAccept,
  onVerdict,
  onBranch,
  onLink,
}: {
  item: TriageItem;
  canAccept: boolean;
  onVerdict: (verdict: TriageVerdict) => void;
  onBranch: (branchId: string) => void;
  /** Follow a read-only link. Never resolves the card — see `TriageLink`. */
  onLink?: (linkId: string) => void;
}) {
  const { t } = useTranslation();
  const links = onLink ? item.links ?? [] : [];

  return (
    <footer className="shrink-0 border-t border-primary/10 bg-secondary/10 px-4 py-3">
      <div className="flex flex-wrap items-center justify-center gap-2">
        <ActionButton
          tone="danger"
          icon={ThumbsDown}
          label={item.verdictLabels.reject}
          onClick={() => onVerdict('reject')}
        />
        <ActionButton
          tone="neutral"
          icon={SkipForward}
          label={item.verdictLabels.skip}
          onClick={() => onVerdict('skip')}
        />
        <ActionButton
          tone="success"
          icon={ThumbsUp}
          label={item.verdictLabels.accept}
          disabled={!canAccept}
          onClick={() => onVerdict('accept')}
        />

        {item.branches.length > 0 ? <div className="mx-1 h-7 w-px bg-primary/12" aria-hidden /> : null}

        {item.branches.map((branch, i) => (
          <button
            key={branch.id}
            type="button"
            onClick={() => onBranch(branch.id)}
            aria-label={branch.label}
            title={branch.hint ?? branch.label}
            className={`focus-ring inline-flex items-center gap-2 rounded-interactive border px-3 py-2 typo-body transition-colors ${TONE_CHIP[branch.tone]} ${TONE_HOVER[branch.tone]}`}
          >
            <Kbd>{String(i + 1)}</Kbd>
            {branch.icon ? <branch.icon className="h-4 w-4 shrink-0" aria-hidden /> : null}
            {branch.label}
          </button>
        ))}

        {/* Links sit AFTER a second divider, deliberately separated from the
            verdict grammar: nothing here resolves the card, so a reviewer must
            never be able to mistake one for a decision. Ghost-weighted for the
            same reason. */}
        {links.length > 0 ? <div className="mx-1 h-7 w-px bg-primary/12" aria-hidden /> : null}

        {links.map((link) => (
          <button
            key={link.id}
            type="button"
            onClick={() => onLink?.(link.id)}
            aria-label={link.label}
            title={link.hint ?? link.label}
            className="focus-ring inline-flex items-center gap-2 rounded-interactive border border-primary/12 px-3 py-2 typo-body text-foreground transition-colors hover:bg-secondary/40"
          >
            <Kbd>O</Kbd>
            {link.icon ? <link.icon className="h-4 w-4 shrink-0" aria-hidden /> : null}
            {link.label}
          </button>
        ))}
      </div>

      <p className="mt-2.5 flex flex-wrap items-center justify-center gap-x-4 gap-y-1 typo-caption">
        <span className="inline-flex items-center gap-1.5">
          <Kbd>
            <ArrowLeft className="h-3 w-3" aria-hidden />
          </Kbd>
          {item.verdictLabels.reject}
        </span>
        <span className="inline-flex items-center gap-1.5">
          <Kbd>
            <ArrowRight className="h-3 w-3" aria-hidden />
          </Kbd>
          {item.verdictLabels.accept}
        </span>
        <span className="inline-flex items-center gap-1.5">
          <Kbd>S</Kbd>
          {item.verdictLabels.skip}
        </span>
        {item.branches.length > 0 ? (
          <span className="inline-flex items-center gap-1.5">
            <Kbd>1</Kbd>
            {item.branches.length > 1 ? <Kbd>{String(item.branches.length)}</Kbd> : null}
            {t.monitor.triage_hint_branch}
          </span>
        ) : null}
        <span className="inline-flex items-center gap-1.5">
          <Kbd>Esc</Kbd>
          {t.monitor.triage_hint_close}
        </span>
      </p>
    </footer>
  );
}
