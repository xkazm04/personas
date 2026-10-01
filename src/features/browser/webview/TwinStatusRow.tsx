/**
 * The one line of feedback the Twin lanes get — INLINE, between the header row
 * and the tab strip, because nothing may float over the page host (a separate
 * OS window). It says what the draft lane is doing per phase, shows the
 * registry-resolved error on failure, and carries the Submit confirmation as a
 * one-liner ("Submit the form? [Submit] [Cancel]") rather than a dialog:
 * `structure.test.ts` forbids `<BaseModal>` on this route for exactly this
 * reason.
 *
 * The Learn lane speaks on the same line, and wins it while it is active (the
 * two never show at once): "n words from host [Teach <twin>] [New twin]
 * [Cancel]", then "Learning in the background", then "n proposals waiting
 * [Open Hub]" or why it failed.
 *
 * Classes match the navigation-refusal line under the address field
 * (`AddressBar.tsx`): `typo-caption`, the warning status for a refusal, the
 * success status for a landed draft, foreground for the rest. Renders nothing while both lanes are idle so the page rect is not
 * taxed for a lane nobody armed.
 */
import { AlertCircle, Check, Highlighter, MousePointerClick } from 'lucide-react';

import AsyncButton from '@/features/shared/components/buttons/AsyncButton';
import Button from '@/features/shared/components/buttons/Button';
import { useTranslation } from '@/i18n/useTranslation';
import { formatNumeric } from '@/lib/utils/formatters';

import type { TwinDraftSnapshot } from '../twinDraftLane';
import type { TwinLearnSnapshot } from '../twinLearnLane';

export interface TwinLearnRowActions {
  learn: TwinLearnSnapshot;
  /** The active twin's name; null hides Teach (New twin needs no twin). */
  activeTwinName: string | null;
  onTeach: () => Promise<void>;
  onNewTwin: () => void;
  onDismissLearn: () => void;
  onOpenHub: () => void;
}

interface TwinStatusRowProps extends TwinLearnRowActions {
  lane: TwinDraftSnapshot;
  onConfirmSubmit: () => Promise<void>;
  onDismissSubmit: () => void;
}

const BAR = 'flex items-center gap-2 px-3 py-1.5 rounded-card border border-primary/15 bg-secondary/30 min-w-0';

export default function TwinStatusRow({ lane, onConfirmSubmit, onDismissSubmit, ...learnProps }: TwinStatusRowProps) {
  const { t, tx } = useTranslation();
  const v = t.browser.twin;

  if (learnProps.learn.phase !== 'idle') return <LearnRow {...learnProps} />;
  if (lane.phase === 'idle') return null;

  const label = lane.target?.label.trim() || v.untitled_box;

  if (lane.confirmingSubmit) {
    return (
      <div role="status" data-testid="webview-twin-status" className={BAR}>
        <span className="typo-caption text-foreground truncate">{v.confirm_submit}</span>
        <AsyncButton size="xs" variant="primary" onClick={onConfirmSubmit} data-testid="webview-twin-submit-confirm">
          {v.submit}
        </AsyncButton>
        <Button size="xs" variant="ghost" onClick={onDismissSubmit} data-testid="webview-twin-submit-dismiss">
          {v.cancel}
        </Button>
      </div>
    );
  }

  const failed = lane.phase === 'failed';
  const Icon = failed ? AlertCircle : lane.phase === 'inserted' ? Check : MousePointerClick;
  const tone = failed ? 'text-status-warning' : lane.phase === 'inserted' ? 'text-status-success' : 'text-foreground/70';
  const text =
    lane.phase === 'armed'
      ? v.armed_hint
      : lane.phase === 'drafting'
        ? tx(v.drafting_into, { label })
        : lane.phase === 'inserted'
          ? tx(v.inserted, { label })
          : `${v.failed_prefix}: ${lane.error ?? ''}`;

  return (
    <p
      role="status"
      aria-live="polite"
      data-testid="webview-twin-status"
      data-phase={lane.phase}
      className={`flex items-center gap-2 px-3 typo-caption ${tone} min-w-0`}
    >
      <Icon className="w-3.5 h-3.5 shrink-0" />
      <span className="truncate">{text}</span>
    </p>
  );
}

/** The Learn lane's line: the capture, the choice, the background run, its result. */
function LearnRow({ learn, activeTwinName, onTeach, onNewTwin, onDismissLearn, onOpenHub }: TwinLearnRowActions) {
  const { t, tx, language } = useTranslation();
  const v = t.browser.twin.learn;
  const count = (n: number) => formatNumeric(n, 'count', { language });

  if (learn.phase === 'choosing') {
    const one = learn.words === 1;
    const what = learn.source === 'selection'
      ? tx(one ? v.choose_selection_one : v.choose_selection_many, { count: count(learn.words), host: learn.host ?? '' })
      : tx(one ? v.choose_clipboard_one : v.choose_clipboard_many, { count: count(learn.words) });
    return (
      <div role="status" data-testid="webview-twin-status" data-learn-phase="choosing" className={BAR}>
        <Highlighter className="w-3.5 h-3.5 shrink-0 text-foreground" aria-hidden="true" />
        <span className="typo-caption text-foreground truncate" data-testid="webview-twin-learn-what">{what}</span>
        {activeTwinName !== null && (
          <AsyncButton size="xs" variant="primary" onClick={onTeach} data-testid="webview-twin-learn-teach">
            {tx(v.teach, { name: activeTwinName })}
          </AsyncButton>
        )}
        <Button size="xs" variant="secondary" onClick={onNewTwin} data-testid="webview-twin-learn-new">
          {v.new_twin}
        </Button>
        <Button size="xs" variant="ghost" onClick={onDismissLearn} data-testid="webview-twin-learn-cancel">
          {v.cancel}
        </Button>
      </div>
    );
  }

  const done = learn.phase === 'done';
  const failed = learn.phase === 'failed';
  const Icon = failed ? AlertCircle : done ? Check : Highlighter;
  const tone = failed ? 'text-status-warning' : done ? 'text-status-success' : 'text-foreground';
  const proposals = learn.proposals ?? 0;
  const text = learn.phase === 'capturing'
    ? v.capturing
    : learn.phase === 'learning'
      ? v.learning
      : done
        ? proposals === 0 ? v.done_none : tx(proposals === 1 ? v.done_one : v.done_many, { count: count(proposals) })
        : failureText(learn, v, t.twin.samples.failed, tx);

  return (
    <div role="status" aria-live="polite" data-testid="webview-twin-status" data-learn-phase={learn.phase}
      className={`flex items-center gap-2 px-3 typo-caption ${tone} min-w-0`}>
      <Icon className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
      <span className="truncate" data-testid="webview-twin-learn-text">{text}</span>
      {done && proposals > 0 && (
        <Button size="xs" variant="secondary" onClick={onOpenHub} data-testid="webview-twin-learn-hub">
          {v.open_hub}
        </Button>
      )}
      {learn.phase !== 'capturing' && (
        <Button size="xs" variant="ghost" onClick={onDismissLearn} data-testid="webview-twin-learn-dismiss">
          {t.common.dismiss}
        </Button>
      )}
    </div>
  );
}

type LearnCopy = ReturnType<typeof useTranslation>['t']['browser']['twin']['learn'];

function failureText(
  learn: TwinLearnSnapshot,
  v: LearnCopy,
  analysisFailed: string,
  tx: ReturnType<typeof useTranslation>['tx'],
): string {
  switch (learn.failure) {
    case 'nothing_selected':
      return v.nothing_selected;
    case 'refused':
      return learn.detail ? tx(v.refused, { reason: learn.detail }) : v.refused_unknown;
    case 'analysis':
      return learn.detail ? `${analysisFailed}: ${learn.detail}` : analysisFailed;
    case 'error':
      return learn.detail ?? analysisFailed;
    case 'capture':
    default:
      return v.failed;
  }
}
