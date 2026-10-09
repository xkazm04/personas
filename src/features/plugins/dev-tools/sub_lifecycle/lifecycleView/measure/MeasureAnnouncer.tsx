// The Measure's live region: always mounted (so assistive tech hears the
// first sentence), visually hidden, polite. It says the start, each command
// as it finishes, a cancel on its way, and the summary (`announce`). Mounted
// under the time cursor (`LifecycleBody`), so it hears a Measure from either
// layer and can read the ended Measure's own runs.
import { useEffect, useRef, useState } from 'react';

import { useTranslation } from '@/i18n/useTranslation';
import { formatDuration } from '@/lib/utils/formatters';

import { useLifecycleViewModel } from '../context';
import { useFragmentText } from '../history/changeText';
import { announce, type AnnounceView, type AnnounceWords } from './announce';
import { useMeasureSession } from './measureSession';
import { useMeasureOutcome } from './useMeasureOutcome';

function useEndedSentence(): string {
  const { dl, tx } = useLifecycleViewModel();
  const { language } = useTranslation();
  const text = useFragmentText();
  const outcome = useMeasureOutcome();
  if (!outcome) return '';
  const changes = outcome.fragments.length > 0
    ? new Intl.ListFormat(language, { style: 'long', type: 'unit' }).format(outcome.fragments.map(text))
    : dl.lcx4_say_none;
  const failed = outcome.failures.map((f) => tx(f.outcome === 'timeout' ? dl.lcx4_timed_out : dl.lcx4_failed, { command: f.commandId }));
  const head = tx(outcome.cancelled ? dl.lcx4_say_cancelled : dl.lcx4_say_finished, { time: formatDuration(outcome.tookMs) });
  return [head, changes, ...failed].map((text) => tx(dl.lcx4_say_sentence, { text })).join(' ');
}

export function MeasureAnnouncer() {
  const { dl, tx } = useLifecycleViewModel();
  const { phase, progress } = useMeasureSession();
  const ended = useEndedSentence();
  const [said, setSaid] = useState('');
  const last = useRef<AnnounceView>({ phase, progress });

  const outcomeWord = (o: string) => (o === 'passed' ? dl.lc2_run_passed : o === 'failed' ? dl.lc2_run_failed : o === 'timeout' ? dl.lc2_run_timeout : dl.lc2_run_did_not_run);
  const words: AnnounceWords = {
    preparing: dl.lcx4_say_preparing,
    started: (count) => tx(dl.lcx4_say_started, { count }),
    done: (c) => {
      const outcome = c.outcome ? outcomeWord(c.outcome) : '';
      return c.durationMs != null && c.outcome !== 'did_not_run'
        ? tx(dl.lcx4_say_done, { command: c.commandId, outcome, time: formatDuration(c.durationMs) })
        : tx(dl.lcx4_say_done_untimed, { command: c.commandId, outcome });
    },
    cancelling: dl.lcx4_say_cancelling,
    ended,
  };
  const wordsRef = useRef(words);
  wordsRef.current = words;

  useEffect(() => {
    const next = { phase, progress };
    const line = announce(last.current, next, wordsRef.current);
    last.current = next;
    if (line) setSaid(line);
  }, [phase, progress]);

  return <p role="status" aria-live="polite" className="sr-only" data-testid="lc-measure-live">{said}</p>;
}
