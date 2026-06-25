// Dev harness for the live-overlay pop-up — kept for ongoing development.
//
// The overlay has no chrome of its own, so the Channels → Timeline top strip
// carries a small "Mock pop-up" button that drives this module, and the overlay
// subscribes to it: emitMockLiveMessage() enqueues ONE synthetic agent-channel
// message so the pop-up can be exercised on demand without waiting for live
// traffic. A module-level event store (not Zustand) keeps it self-contained.
//
// (The /prototype A/B picker that also lived here was removed once the messenger
// "Bubble" presentation won; only the on-demand mock remains.)

import type { LiveMessage } from './liveModel';

// ── Mock injection ──────────────────────────────────────────────────────────
const mockSubs = new Set<(m: LiveMessage) => void>();

/** Overlay subscribes here; returns an unsubscribe. */
export function onMockLiveMessage(cb: (m: LiveMessage) => void): () => void {
  mockSubs.add(cb);
  return () => { mockSubs.delete(cb); };
}

// A small rotating cast so repeated clicks show varied agent chatter — a
// handoff, an Athena review gate, a QA flag, a deploy — across persona/athena
// authors and alert/non-alert tones. Mirrors the real LiveMessage shape that
// projectChannelItem() produces from the live feed.
type MockSeed = Omit<LiveMessage, 'id' | 'at' | 'receivedAt'>;
const MOCK_CAST: MockSeed[] = [
  {
    teamId: 'mock-web', teamName: 'Web Platform', teamColor: '#06b6d4',
    personaId: 'mock-fe', personaName: 'Frontend Dev', personaIcon: 'agent-icon:code', personaColor: '#06b6d4',
    kind: 'persona', event: 'handoff', tone: 'text-status-info',
    message: 'Pushed the auth refactor — QA can pick it up. PR #1487 is green and rebased on main.',
    alert: false,
  },
  {
    teamId: 'mock-web', teamName: 'Web Platform', teamColor: '#06b6d4',
    personaId: null, personaName: '', personaIcon: null, personaColor: null,
    kind: 'athena', event: 'needs your review', tone: 'text-violet-300',
    message: 'Two runs are blocked on a merge-authority call. Want me to approve the lower-risk one?',
    alert: true,
  },
  {
    teamId: 'mock-qa', teamName: 'QA Guild', teamColor: '#f59e0b',
    personaId: 'mock-qa1', personaName: 'QA Guardian', personaIcon: 'agent-icon:security', personaColor: '#ef4444',
    kind: 'persona', event: 'flagged', tone: 'text-status-warning',
    message: 'Login regresses on Safari 17 — the session cookie drops on redirect. Logged as run #1493.',
    alert: true,
  },
  {
    teamId: 'mock-ops', teamName: 'Ops', teamColor: '#0ea5e9',
    personaId: 'mock-ops1', personaName: 'DevOps', personaIcon: 'agent-icon:devops', personaColor: '#0ea5e9',
    kind: 'persona', event: 'deployed', tone: 'text-status-success',
    message: 'Shipped v2.4.0 to staging — smoke tests passed. Rolling to prod in ~10 minutes.',
    alert: false,
  },
];

let n = 0;
export function emitMockLiveMessage(): void {
  const seed = MOCK_CAST[n % MOCK_CAST.length]!;
  n += 1;
  const now = Date.now();
  const msg: LiveMessage = {
    ...seed,
    id: `mock-${now}-${n}`,
    at: new Date(now).toISOString(),
    receivedAt: now,
  };
  mockSubs.forEach((fn) => fn(msg));
}
