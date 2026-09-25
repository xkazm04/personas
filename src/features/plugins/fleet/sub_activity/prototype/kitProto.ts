/**
 * Gate K decision prototype (spark style-unification, 2026-09-25).
 *
 * The owner shortlisted two composition kits from the `style-kit` contest, A/1 "Ledger" and
 * A/3 "Spine & Lens", and asked to see BOTH ported onto one real content page before choosing.
 * Fleet Activity renders either kit from the same live data through this contract. Everything
 * under `prototype/` (and the two `kit-proto/` folders it renders) is deleted, or promoted, when
 * the owner decides. It is dev-only: production always renders the current page.
 */
import type { FleetTranscriptSummary } from '@/lib/bindings/FleetTranscriptSummary';
import { silentCatch } from '@/lib/silentCatch';

export type ActivityKit = 'current' | 'ledger' | 'spine';
export const ACTIVITY_KITS: readonly ActivityKit[] = ['current', 'ledger', 'spine'];

/** The page's real state and handlers, handed unchanged to whichever kit renders it. */
export interface ActivityKitProps {
  /** Every transcript the backend returned (unfiltered). */
  rows: FleetTranscriptSummary[];
  /** Rows after the search query (what a list should show). */
  filtered: FleetTranscriptSummary[];
  loading: boolean;
  failed: boolean;
  query: string;
  setQuery: (q: string) => void;
  onRefresh: () => void;
  /** Opens the live session (switching to Sessions) or the transcript's insights. */
  onOpen: (row: FleetTranscriptSummary) => void;
  /** Live registry: which transcripts belong to a running session (keyed by claudeSessionId). */
  liveSessionIds: ReadonlySet<string>;
}

const STORAGE_KEY = 'personas:kit-proto';

/** `?kit=ledger|spine` wins (the page harness shoots with it), then localStorage, then current. */
export function readActivityKit(): ActivityKit {
  if (!import.meta.env.DEV) return 'current';
  try {
    const fromUrl = new URLSearchParams(window.location.search).get('kit');
    if (fromUrl && (ACTIVITY_KITS as readonly string[]).includes(fromUrl)) return fromUrl as ActivityKit;
    const stored = window.localStorage.getItem(STORAGE_KEY);
    if (stored && (ACTIVITY_KITS as readonly string[]).includes(stored)) return stored as ActivityKit;
  } catch (e) {
    // Storage blocked (private window, thumbnail capture): the current page is the safe default.
    silentCatch('kitProto:readActivityKit')(e);
    return 'current';
  }
  return 'current';
}

export function writeActivityKit(kit: ActivityKit): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, kit);
  } catch (e) {
    // Storage blocked: the switch still works for this mount through component state.
    silentCatch('kitProto:writeActivityKit')(e);
  }
}
