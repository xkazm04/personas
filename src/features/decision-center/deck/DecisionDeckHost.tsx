/**
 * DecisionDeckHost — the single global mount of the Decision Deck.
 *
 * Mounted once in the app's GlobalOverlays (lazy island "decision-deck"), so
 * it is on the startup path and stays deliberately small: the deck itself
 * (`LiveDeck`: the modal, its card shapes, the writers) is a separate chunk
 * fetched the first time `openDecisionDeck` sets a request. Until 2026-10-25
 * both lived in this module, and the host's always-loaded chunk was ~416 KB.
 */
import { Suspense } from 'react';
import { lazyRetry } from '@/lib/lazyRetry';
import { usePreloadedSections } from '@/i18n/useTranslation';
import { useDecisionDeckStore } from './deckStore';
import { LensSheetHost } from '../lens/LensSheetHost';

// The deck renders as a modal over the app (DeckModal), so while its chunk
// loads nothing is the right thing to paint - an overlay's fallback, not a view's.
const LiveDeckModal = lazyRetry(() => import('./LiveDeck'));

export default function DecisionDeckHost() {
  const request = useDecisionDeckStore((s) => s.request);
  const session = useDecisionDeckStore((s) => s.session);
  // `decisionCenter` is an OVERLAY_SECTIONS entry: not loaded before first paint.
  usePreloadedSections(['decisionCenter'], session !== 0);
  return (
    <>
      {/* Never opened: mount no deck, read nothing, fetch nothing. */}
      {session !== 0 && (
        <Suspense fallback={null}>
          <LiveDeckModal request={request} session={session} />
        </Suspense>
      )}
      {/* The blueprint sheet (or a release's composition), over the deck. Mounted whether or not the deck ever
          opened: a lens-scan card opens it, and so does the Monitor's Blueprint picker, which needs no deck. */}
      <LensSheetHost />
    </>
  );
}
