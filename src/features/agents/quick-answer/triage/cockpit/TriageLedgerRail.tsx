/**
 * TriageLedgerRail — the right pane: what the item IS, then what you can do
 * about it, docked together at the bottom of the same column.
 *
 * The pairing is the point. A decision made while the facts are two scrolls
 * away is a decision made from memory, so the verdicts sit at the foot of the
 * ledger they depend on — the same move `BacklogDetailLedger` makes at modal
 * size, here at app size with room for the branches.
 *
 * The dock is built from the CATALOG `Button` (tone via `accentColor`, so the
 * colour language stays the app's) with the shortcut cap in `iconRight`. It
 * does NOT use `DecisionActions`: that primitive nowrap-centres a bare string
 * label, and this variant's contract is that every action wears its key.
 *
 * ⚠️ PROTOTYPE (/prototype round 1): English literals inline, `src/i18n/**` is
 * off-limits this round. See cockpitKinds.tsx for the full note.
 */
import { Check, ChevronRight, Moon, X } from 'lucide-react';

import Button, { type AccentColor } from '@/features/shared/components/buttons/Button';
import { RelativeTime } from '@/features/shared/components/display/RelativeTime';

import type { TriageItem, TriageTone, TriageVerdict } from '../triageTypes';
import { FactRow } from './FactMeter';
import { ShortcutChip } from './ShortcutChip';

/** Branch tone → the catalog Button's own accent stem. Neutral stays a plain
 *  secondary so a queue of branches doesn't read as five competing CTAs. */
const BRANCH_ACCENT: Record<TriageTone, AccentColor | null> = {
  neutral: null,
  accent: 'cyan',
  success: 'emerald',
  warning: 'amber',
  danger: 'rose',
};

export function TriageLedgerRail({
  item,
  busy,
  acceptBlockedReason,
  onVerdict,
  onBranch,
}: {
  item: TriageItem;
  busy: boolean;
  /** Set when accept can't fire yet (a question with no answer) — becomes the
   *  disabled button's tooltip rather than a silently dead control. */
  acceptBlockedReason?: string;
  onVerdict: (verdict: TriageVerdict) => void;
  onBranch: (index: number) => void;
}) {
  const labels = item.verdictLabels;

  return (
    <aside
      className="w-[300px] shrink-0 flex flex-col border-l border-primary/12 bg-secondary/10"
      aria-label="Facts and decision"
    >
      <div className="flex-1 min-h-0 overflow-y-auto px-4 py-3">
        <h2 className="typo-label text-muted-foreground">Ledger</h2>
        <div className="divide-y divide-primary/10">
          {item.facts.map((fact) => (
            <FactRow key={fact.id} fact={fact}>
              {fact.id === 'raised' ? (
                <RelativeTime timestamp={fact.value} className="typo-body text-foreground" />
              ) : undefined}
            </FactRow>
          ))}
        </div>
      </div>

      <div className="shrink-0 border-t border-primary/12 bg-background/70 px-4 py-3.5 flex flex-col gap-2">
        <span className="typo-label text-muted-foreground">Decide</span>

        <Button
          block
          size="md"
          variant="accent"
          accentColor="emerald"
          icon={<Check className="w-4 h-4" />}
          iconRight={<ShortcutChip keys="A" />}
          disabled={busy || !!acceptBlockedReason}
          disabledReason={acceptBlockedReason}
          aria-label={`${labels.accept} — shortcut A`}
          title={`${labels.accept} (A)`}
          onClick={() => onVerdict('accept')}
        >
          {labels.accept}
        </Button>

        <Button
          block
          size="md"
          variant="ghost"
          className="border border-primary/12 hover:text-status-error hover:border-status-error/30"
          icon={<X className="w-4 h-4" />}
          iconRight={<ShortcutChip keys="R" />}
          disabled={busy}
          aria-label={`${labels.reject} — shortcut R`}
          title={`${labels.reject} (R)`}
          onClick={() => onVerdict('reject')}
        >
          {labels.reject}
        </Button>

        <Button
          block
          size="md"
          variant="ghost"
          className="border border-primary/12"
          icon={<Moon className="w-4 h-4" />}
          iconRight={<ShortcutChip keys="S" />}
          disabled={busy}
          aria-label={`${labels.skip} — shortcut S. Stays in the queue, sorted last.`}
          title={`${labels.skip} (S) — stays in the queue, sorted last`}
          onClick={() => onVerdict('skip')}
        >
          {labels.skip}
        </Button>

        {item.branches.length > 0 && (
          <>
            <div className="h-px bg-primary/12 mt-1.5" />
            <span className="typo-label text-muted-foreground">Or take it further</span>
            {item.branches.slice(0, 9).map((branch, i) => {
              const accent = BRANCH_ACCENT[branch.tone];
              const BranchIcon = branch.icon ?? ChevronRight;
              const digit = String(i + 1);
              return (
                <div key={branch.id} className="flex flex-col gap-1">
                  <Button
                    block
                    size="md"
                    variant={accent ? 'accent' : 'secondary'}
                    accentColor={accent ?? undefined}
                    icon={<BranchIcon className="w-4 h-4" />}
                    iconRight={<ShortcutChip keys={digit} />}
                    disabled={busy}
                    aria-label={`${branch.label} — shortcut ${digit}`}
                    title={branch.hint ? `${branch.label} (${digit}) — ${branch.hint}` : `${branch.label} (${digit})`}
                    onClick={() => onBranch(i)}
                  >
                    <span className="truncate">{branch.label}</span>
                  </Button>
                  {branch.hint && (
                    <span className="typo-caption text-foreground px-1 leading-snug">
                      {branch.hint}
                    </span>
                  )}
                </div>
              );
            })}
          </>
        )}
      </div>
    </aside>
  );
}
