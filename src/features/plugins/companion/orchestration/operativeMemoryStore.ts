import { create } from 'zustand';

/**
 * Operative-memory digest store — Direction 7 (live ops view).
 *
 * Backend emits `athena://orchestration/digest-changed` from every
 * mutation entry point (fleet_bridge, MCP handlers, dispatcher, PTY
 * reaper). The bridge debounces those events 250ms client-side and
 * re-fetches the full digest via `companion_get_operative_memory_digest`.
 *
 * Why no delta protocol: the wire format stays stable. The digest
 * text format is allowed to evolve freely — the strip just renders
 * whatever the backend returns.
 *
 * Why a separate store from companionStore: digest mutations fire at
 * sub-second cadence during active orchestration (every tool call,
 * every checkpoint). Mixing into the main store would cause the chat
 * panel and ApprovalCards to re-render on noise unrelated to them.
 */

interface OperativeMemoryStore {
  /**
   * The most-recently-fetched digest text. Empty string when no
   * operations are in flight. Backend returns markdown so the strip
   * can render with minimal formatting (or eventually a richer
   * react-markdown pass).
   */
  digest: string;
  /** Unix ms of the most-recent backend fetch. */
  lastUpdatedAt: number | null;
  /** True while a re-fetch is in flight. */
  fetching: boolean;
  /**
   * UI affordance — strip starts collapsed because most users won't
   * have orchestration in flight; expand on click. Persists for the
   * session (resets on app restart).
   */
  expanded: boolean;

  setDigest: (digest: string) => void;
  setFetching: (v: boolean) => void;
  setExpanded: (v: boolean) => void;
}

export const useOperativeMemoryStore = create<OperativeMemoryStore>((set) => ({
  digest: '',
  lastUpdatedAt: null,
  fetching: false,
  expanded: false,

  setDigest: (digest) =>
    set({
      digest,
      lastUpdatedAt: Date.now(),
    }),
  setFetching: (fetching) => set({ fetching }),
  setExpanded: (expanded) => set({ expanded }),
}));
