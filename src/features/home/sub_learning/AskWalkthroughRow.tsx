import { useRef, useState } from 'react';
import { Compass } from 'lucide-react';
import { KitButton, GhostRows } from '@/features/shared/components/kit';
import { useTranslation } from '@/i18n/useTranslation';
import { useTourStore } from '@/stores/tourStore';
import { composeTour, ingestComposedTour } from '@/stores/slices/system/dynamicTours';
import { silentCatch } from '@/lib/silentCatch';

type AskState = 'idle' | 'composing' | 'failed';

/**
 * "Ask Athena for a walkthrough": the user-initiated entry point to the same
 * compose + ingest path `WalkthroughOfferWidget` uses when Athena volunteers.
 * Composition is one LLM call, so it only ever runs on an explicit press with a
 * non-empty topic, and a second press is ignored while one is in flight.
 */
export function AskWalkthroughRow({ onComposed }: { onComposed: () => void }) {
  const { t } = useTranslation();
  const ht = t.home.learning;
  const [topic, setTopic] = useState('');
  const [state, setState] = useState<AskState>('idle');
  const inFlight = useRef(false);
  const trimmed = topic.trim();
  const composing = state === 'composing';

  const submit = () => {
    if (!trimmed || inFlight.current) return;
    inFlight.current = true;
    setState('composing');
    composeTour(trimmed)
      .then((record) => {
        const id = ingestComposedTour(record);
        if (!id) {
          setState('failed');
          return;
        }
        setState('idle');
        setTopic('');
        onComposed();
        useTourStore.getState().startTour(id);
      })
      .catch((err) => {
        silentCatch('home/sub_learning/AskWalkthroughRow:compose')(err);
        setState('failed');
      })
      .finally(() => {
        inFlight.current = false;
      });
  };

  return (
    <div className="mb-3" data-testid="learning-ask-walkthrough">
      <form
        className="flex items-center gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
      >
        <input
          type="text"
          className="typo-body flex-1 min-w-0 h-9 px-3 rounded-input border border-primary/15 bg-transparent"
          data-testid="learning-ask-walkthrough-input"
          aria-label={ht.ask_title}
          placeholder={ht.ask_placeholder}
          value={topic}
          disabled={composing}
          onChange={(e) => {
            setTopic(e.target.value);
            if (state === 'failed') setState('idle');
          }}
        />
        <KitButton
          tone="primary"
          icon={<Compass />}
          onClick={submit}
          disabled={!trimmed || composing}
          testId="learning-ask-walkthrough-submit"
        >
          {ht.ask_submit}
        </KitButton>
      </form>
      <span className="sr-only" role="status">{composing ? ht.ask_composing : ''}</span>
      {composing && (
        <div className="mt-2" data-testid="learning-ask-walkthrough-composing">
          <p className="typo-caption k-quiet m-0">{ht.ask_composing}</p>
          <GhostRows count={1} size="s" />
        </div>
      )}
      {state === 'failed' && (
        <p className="typo-body k-toned t-error m-0 mt-2" role="alert" data-testid="learning-ask-walkthrough-failed">
          {ht.ask_failed}
        </p>
      )}
    </div>
  );
}
