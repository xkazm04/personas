/** @catalog TriageFocus part: the three-verdict action bar, its note field and the keyboard legend. */
// TriageFocusActions — the bar you decide from, and the legend that says how.
//
// THREE VERDICTS, NAMED BY THE ITEM. The donor hardcoded "Approve" / "Reject" /
// "Retry with changes"; the third of those was not a verdict at all but a
// REJECT carrying the literal string `[RETRY]` glued onto the front of the
// note, which the backend then had to sniff back out of prose. Here the bar is
// the spine — accept / reject / skip — wearing `item.verdictLabels`, and
// anything beyond the spine is a BRANCH the item declares, digit-hotkeyed, so
// "retry with changes" can exist honestly as a branch instead of as a marker
// hidden in free text.
//
// ARM, THEN CONFIRM. One press arms a verdict and opens its note; the second
// press on the same key (or the Confirm button) writes it. That two-press
// gesture is what makes the keyboard safe on a surface where a single arrow
// key resolves real work.
import { Check, SkipForward, X } from 'lucide-react';

import Button from '@/features/shared/components/buttons/Button';
import { Collapse } from '@/features/shared/components/display/Collapse';
import { MarkdownMiniEditor } from '@/features/shared/components/editors/MarkdownMiniEditor';
import { InlineErrorBanner } from '@/features/shared/components/feedback/InlineErrorBanner';
import { Kbd, TONE_TEXT, type TriageItem, type TriageVerdict } from '@/features/shared/triage/triageFocusBridge';
import { useTranslation } from '@/i18n/useTranslation';
import { resolveErrorTranslated } from '@/i18n/useTranslatedError';

import type { TriageFocusController } from './useTriageFocus';

const SPINE: { verdict: TriageVerdict; tone: 'error' | 'warning' | 'success'; Icon: typeof Check }[] = [
  { verdict: 'reject', tone: 'error', Icon: X },
  { verdict: 'skip', tone: 'warning', Icon: SkipForward },
  { verdict: 'accept', tone: 'success', Icon: Check },
];

export function TriageFocusActions({
  item, ctl, hasOptions,
}: {
  item: TriageItem;
  ctl: TriageFocusController;
  /** Multi-decision mode: the spine buttons rule on ALL options at once. */
  hasOptions: boolean;
}) {
  const { t } = useTranslation();
  const m = t.monitor;
  const { armed, setArmed, note, setNote, busy, error, dismissError, commit, setAllOptions } = ctl;

  const press = (verdict: TriageVerdict) => {
    if (armed === verdict) { void commit(verdict); return; }
    if (hasOptions && verdict !== 'skip') setAllOptions(verdict === 'accept' ? 'accept' : 'reject');
    setArmed(verdict);
    setNote('');
  };

  return (
    <div className="border-t border-primary/10" data-testid="triage-focus-actions">
      {error && (
        <div className="px-3 pt-3">
          <InlineErrorBanner
            compact
            title={m.triage_focus_failed_title}
            message={resolveErrorTranslated(t, error).message}
            onDismiss={dismissError}
            onRetry={armed ? () => void commit(armed) : undefined}
          />
        </div>
      )}

      <div className="grid grid-cols-3 divide-x divide-primary/10">
        {SPINE.map(({ verdict, tone, Icon }) => (
          <Button
            key={verdict}
            variant={armed === verdict ? 'accent' : 'ghost'}
            tone={armed === verdict ? tone : undefined}
            size="md"
            block
            disabled={busy}
            aria-pressed={armed === verdict}
            onClick={() => press(verdict)}
            icon={<Icon className="h-4 w-4" />}
            className="!rounded-none py-4"
            data-testid={`triage-focus-${verdict}`}
          >
            {hasOptions && verdict !== 'skip'
              ? `${item.verdictLabels[verdict]} · ${m.triage_focus_all}`
              : item.verdictLabels[verdict]}
          </Button>
        ))}
      </div>

      <Collapse open={armed !== null} unmountWhenClosed duration={200}>
        <div className="space-y-2 px-3 pb-3 pt-2">
          <MarkdownMiniEditor
            value={note}
            onChange={setNote}
            onCancel={() => { setArmed(null); setNote(''); }}
            rows={2}
            placeholder={m.triage_focus_note_placeholder}
            ariaLabel={m.triage_focus_note_label}
            testId="triage-focus-note"
            // MarkdownMiniEditor renders a BARE textarea and takes its whole
            // surface from the caller (`className` is passed straight through),
            // so an unstyled note field is a missing prop, not a missing
            // primitive. This is the app's input recipe.
            className="focus-ring w-full resize-none rounded-input border border-primary/15 bg-background/60 px-3 py-2 typo-body text-foreground"
          />
          <div className="flex items-center gap-2">
            <Button
              variant="accent"
              tone={armed === 'accept' ? 'success' : armed === 'reject' ? 'error' : 'warning'}
              size="sm"
              block
              loading={busy}
              onClick={() => armed && void commit(armed)}
              data-testid="triage-focus-confirm"
            >
              {m.triage_focus_confirm}
            </Button>
            <Button variant="ghost" size="sm" disabled={busy} onClick={() => { setArmed(null); setNote(''); }}>
              {m.triage_focus_cancel}
            </Button>
          </div>
        </div>
      </Collapse>

      {item.branches.length > 0 && (
        <div className="flex flex-wrap items-center gap-2 border-t border-primary/5 px-3 py-2">
          <span className="typo-caption">{m.triage_focus_branches}</span>
          {item.branches.slice(0, 9).map((branch, i) => (
            <Button
              key={branch.id}
              variant="secondary"
              size="xs"
              disabled={busy}
              onClick={() => void commit('accept', { branchId: branch.id })}
              icon={<Kbd>{i + 1}</Kbd>}
              data-testid={`triage-focus-branch-${branch.id}`}
            >
              <span className={TONE_TEXT[branch.tone]}>{branch.label}</span>
            </Button>
          ))}
        </div>
      )}

      <div className="flex flex-wrap items-center justify-center gap-x-3 gap-y-1 border-t border-primary/5 py-1.5 typo-caption">
        <span className="flex items-center gap-1"><Kbd>&#8592;</Kbd>{item.verdictLabels.reject}</span>
        <span className="flex items-center gap-1"><Kbd>&#8595;</Kbd>{item.verdictLabels.skip}</span>
        <span className="flex items-center gap-1"><Kbd>&#8594;</Kbd>{item.verdictLabels.accept}</span>
        <span className="flex items-center gap-1">
          <Kbd>&#8629;</Kbd>{armed ? m.triage_focus_arm_hint : m.triage_focus_legend_arm}
        </span>
        {item.branches.length > 0 && (
          <span className="flex items-center gap-1"><Kbd>1&#8230;9</Kbd>{m.triage_focus_legend_branch}</span>
        )}
      </div>
    </div>
  );
}
