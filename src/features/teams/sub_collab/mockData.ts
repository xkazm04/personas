/* ----------------------------------------------------------------------------
 * MOCK DATA — Collab design comparison.
 *
 * One realistic SDLC mission ("Add amount validation to the bill parser"),
 * told once, rendered by three variants that embody the three living-chat
 * designs (A: composed channel · B: read-model + acks · C: dialogue-native).
 * Everything here is fabricated; nothing reads the DB. The cast mirrors the
 * real sdlc-lifecycle roster so the comparison feels true to production.
 * -------------------------------------------------------------------------- */

export interface MockMember {
  id: string;
  name: string;
  callsign: string;
  role: string;
  color: string;
  /** What the member is doing right now (drives presence in B/C). */
  presence: 'working' | 'idle' | 'waiting';
}

export const MOCK_MEMBERS: MockMember[] = [
  { id: 'strategist', name: 'Product Strategist', callsign: 'STRATEGIST', role: 'product', color: '#e879f9', presence: 'idle' },
  { id: 'architect', name: 'Solution Architect', callsign: 'ARCHITECT', role: 'architect', color: '#a78bfa', presence: 'idle' },
  { id: 'dev', name: 'Dev Clone', callsign: 'DEV-CLONE', role: 'engineer', color: '#60a5fa', presence: 'working' },
  { id: 'qa', name: 'QA Guardian', callsign: 'QA-GUARDIAN', role: 'qa', color: '#fbbf24', presence: 'waiting' },
  { id: 'security', name: 'Security Auditor', callsign: 'SECURITY', role: 'security', color: '#f87171', presence: 'idle' },
  { id: 'release', name: 'Release Manager', callsign: 'RELEASE', role: 'release', color: '#34d399', presence: 'idle' },
];

export const MOCK_USER = { id: 'user', name: 'You', callsign: 'COMMANDER', color: '#f8fafc' };

export type BeatKind =
  | 'note'        // strategist/system context line
  | 'handoff'     // step done → next persona
  | 'message'     // a persona "says" something (status/summary)
  | 'artifact'    // PR / release produced
  | 'bounce'      // QA changes requested (thread with reason)
  | 'question'    // awaiting_review — the team asks the USER (intervention point)
  | 'memory'      // shared memory written
  | 'directive'   // the user's message into the channel
  | 'reply';      // persona replying to a directive/question (C-style)

export interface MockBeat {
  id: string;
  kind: BeatKind;
  memberId: string;          // 'user' for directives
  minutesAgo: number;        // relative time, newest = smallest
  text: string;
  /** Optional artifact chip. */
  artifact?: { label: string; url: string };
  /** For bounce/reply threads: the beat this responds to. */
  replyTo?: string;
  /** B-only: which members acknowledged (read-receipt demo). */
  seenBy?: string[];
  /** C-only: marks the live "working" bubble that can be interrupted. */
  interruptible?: boolean;
}

/** The shared story — chronological (oldest first). */
export const MOCK_BEATS: MockBeat[] = [
  { id: 'b1', kind: 'note', memberId: 'strategist', minutesAgo: 94, text: 'Ranked the backlog — "Amount validation" is priority 1 (medical bills with malformed totals are the top support complaint). Promoted to goal.' },
  { id: 'b2', kind: 'handoff', memberId: 'architect', minutesAgo: 88, text: 'Scoped the work: extend parseMoney() with currency-aware bounds checks + reject negative totals. 3 steps, handing implementation to Dev Clone.' },
  { id: 'b3', kind: 'message', memberId: 'dev', minutesAgo: 71, text: 'Implementing on branch feat/amount-validation — bounds table done, wiring validators into the parser pipeline.' },
  { id: 'b4', kind: 'artifact', memberId: 'dev', minutesAgo: 63, text: 'Opened PR #12 — amount validation with 14 new unit tests.', artifact: { label: 'PR #12', url: 'https://github.com/xkazm04/xprize-medical-bill/pull/12' } },
  { id: 'b5', kind: 'bounce', memberId: 'qa', minutesAgo: 55, replyTo: 'b4', text: 'Changes requested: parseMoney("1,000.00") regresses on comma-grouped values — 2 of my edge-case tests fail. Bouncing back with repro.' },
  { id: 'b6', kind: 'message', memberId: 'dev', minutesAgo: 41, replyTo: 'b5', text: 'Round 2 — locale-aware grouping handled, both repro tests green. Pushed to the same branch.' },
  { id: 'b7', kind: 'message', memberId: 'qa', minutesAgo: 32, replyTo: 'b6', text: 'Re-tested in isolated worktree: 196/196 passing. Merging PR #12.', artifact: { label: 'merged', url: 'https://github.com/xkazm04/xprize-medical-bill/pull/12' } },
  { id: 'b8', kind: 'memory', memberId: 'qa', minutesAgo: 31, text: 'Constraint saved: money parsing must handle locale grouping — always include comma/period-grouped cases in parser tests.' },
  { id: 'b9', kind: 'artifact', memberId: 'release', minutesAgo: 18, text: 'Published v0.4.2 — changelog updated, tag pushed.', artifact: { label: 'v0.4.2', url: 'https://github.com/xkazm04/xprize-medical-bill/releases/tag/v0.4.2' } },
  { id: 'b10', kind: 'question', memberId: 'security', minutesAgo: 9, text: 'Found raw bill contents in debug logs (possible PHI). I can redact-and-continue, or pause the pipeline for your call — this touches the privacy policy.', interruptible: false },
  { id: 'b11', kind: 'message', memberId: 'dev', minutesAgo: 2, text: 'Working: extracting the bill-export module (step 2 of 4)…', interruptible: true },
];

/** B/C demo: the beats that "arrive live" when simulation plays. */
export const MOCK_LIVE_BEATS: MockBeat[] = [
  { id: 'l1', kind: 'message', memberId: 'dev', minutesAgo: 0, text: 'Export module extracted — 0 type errors, moving to wire the CSV writer.' },
  { id: 'l2', kind: 'handoff', memberId: 'dev', minutesAgo: 0, text: 'Step 2 done → handing CSV schema review to Architect.' },
  { id: 'l3', kind: 'message', memberId: 'architect', minutesAgo: 0, text: 'Schema looks right — one nit: emit ISO dates, not locale dates. Approving with note.' },
];

/** C demo: scripted replies when the user interjects mid-dialogue. */
export const MOCK_C_REPLIES: Record<string, MockBeat[]> = {
  interrupt: [
    { id: 'c1', kind: 'reply', memberId: 'dev', minutesAgo: 0, text: 'Paused at a clean checkpoint (module extracted, nothing half-written). What should I change?' },
  ],
  directive: [
    { id: 'c2', kind: 'reply', memberId: 'dev', minutesAgo: 0, text: 'Understood — I’ll finish the CSV writer with ISO dates and skip the XLSX variant for now.' },
    { id: 'c3', kind: 'reply', memberId: 'qa', minutesAgo: 0, text: 'Noting it: my export tests will assert ISO format. Resuming watch.' },
  ],
};

export function memberById(id: string): MockMember | undefined {
  return MOCK_MEMBERS.find((m) => m.id === id);
}
