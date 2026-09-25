/**
 * A PLACEMENT: text the app typed into a box on a surface it does not own (a
 * comment field on a web page), where that surface's own send button is the
 * human gate and the app never learns whether it was pressed.
 *
 * The communications table only knows `in` and `out`, and `out` means "sent by
 * the twin". A placement is neither: the person may edit it, send it, or close
 * the tab, and nothing reports back. So the row is still written - it is the
 * app's own act, what it placed, where and when - but tagged in
 * `key_facts_json` (an opaque passthrough nothing in Rust parses, the same
 * column `topicCoverage.ts` tags training pairs in), and every reader that
 * means "sent" leaves it out. Filing it as a send would be a verdict nobody
 * observed.
 */
import type { TwinCommunication } from '@/lib/bindings/TwinCommunication';

/** `key_facts_json.kind` marking a draft placed into a box the app does not own. */
const PLACEMENT_KIND = 'placement';

/** The `key_facts_json` payload for one placement. */
export function placementFacts(): string {
  return JSON.stringify({ kind: PLACEMENT_KIND });
}

/** True when this communication records a placement rather than a message that was sent or received. */
function isPlacement(comm: Pick<TwinCommunication, 'key_facts_json'>): boolean {
  const raw = comm.key_facts_json;
  if (!raw || !raw.includes(PLACEMENT_KIND)) return false;
  try {
    const parsed: unknown = JSON.parse(raw);
    return (
      !!parsed &&
      typeof parsed === 'object' &&
      !Array.isArray(parsed) &&
      (parsed as { kind?: unknown }).kind === PLACEMENT_KIND
    );
  } catch {
    return false;
  }
}

/** A communication that reads as sent: outbound, and not a placement. */
export function isSentMessage(comm: Pick<TwinCommunication, 'direction' | 'key_facts_json'>): boolean {
  return comm.direction === 'out' && !isPlacement(comm);
}
