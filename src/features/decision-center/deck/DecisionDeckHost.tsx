/**
 * DecisionDeckHost — the single global mount of the Decision Deck.
 *
 * Mounted once in the app's GlobalOverlays (lazy chunk). It renders nothing
 * until `openDecisionDeck` sets a request, then shows the deck (portal, above
 * every surface including the Monitor). WP0 stub (decision-center wave 3):
 * package C1a turns it into the live deck over the roster.
 */
import { useDecisionDeckStore } from './deckStore';

export default function DecisionDeckHost() {
  const request = useDecisionDeckStore((s) => s.request);
  if (!request) return null;
  return null;
}
