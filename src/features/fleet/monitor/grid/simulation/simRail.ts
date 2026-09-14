// simRail — rows for the Activity rail's three tabs.
//
// The rail is the half of this surface a screenshot of an empty dev database
// never shows: three tabs whose real feeds reach the unified triage queue, the
// undispatched-idea backlog and the merged channel cache, none of which have
// anything in them on a fresh isolated instance. So the simulation supplies
// `RailRow`s directly — the same projection the three adapters in `railModel`
// produce — and `ActivityRail` renders them through its own list, its own row
// component and its own virtualizer.
//
// LABELS ARRIVE PRE-TRANSLATED, exactly as `railModel` requires of every
// adapter (its rule 2): this module never touches the translation proxy, so a
// caller decides the copy. Row TITLES are simulated content, not chrome —
// they are the mock equivalent of a review's own text, which is never
// translated on the real path either.

import { AlertCircle, FileText, Inbox, MessageSquare } from 'lucide-react';
import type { RailRow } from '../rail/railModel';
import {
  int, mulberry32, pick, PROJECT_NAMES, ROLE_NAMES, SEED, TEAM_COLORS, type Rand,
} from './simRandom';

/** The three kind labels the rows carry, resolved by the caller. */
export interface SimRailLabels {
  review: string;
  dispatch: string;
  message: string;
}

export interface SimRailRows {
  reviews: RailRow[];
  dispatch: RailRow[];
  messages: RailRow[];
}

const REVIEW_TITLES: readonly string[] = [
  'Retry loop has no ceiling — a wedged tool call runs forever',
  'Migration 0042 drops `last_seen_at`, which two views still select',
  'Connector reads its token from the environment, not the vault',
  'Endpoint answers 200 before the write is durable',
  'Empty state renders before the first read lands',
  'Scheduler double-fires when a run overlaps its own window',
  'Ghost row height and real row height disagree by 4px',
];

const DISPATCH_TITLES: readonly string[] = [
  'Split the settings module along its two real seams',
  'Add a coverage gate to the release workflow',
  'Cache the project lookup — it is read once per row',
  'Retire the second toast queue',
  'Give the empty state a first action',
];

const MESSAGE_TITLES: readonly string[] = [
  'Nightly sweep finished — three items are waiting on you',
  'Coverage moved 71% to 78% after the parser split',
  'The flaky migration test failed twice, passed on retry',
  'Blocked: the staging credential expired an hour ago',
  'Draft release notes are ready to read',
  'Dependency bump needs a decision before Friday',
];

function reviewRow(i: number, label: string, rand: Rand): RailRow {
  const project = pick(rand, PROJECT_NAMES);
  const tone = pick(rand, ['danger', 'warning', 'neutral'] as const);
  return {
    id: `sim-rail-review-${i}`,
    tone,
    code: 'REV',
    kind: label,
    icon: AlertCircle,
    title: pick(rand, REVIEW_TITLES),
    source: `${project} · ${pick(rand, ROLE_NAMES)}`,
    at: new Date(Date.now() - int(rand, 5, 2_800) * 60_000).toISOString(),
    body: null,
    accent: pick(rand, TEAM_COLORS),
    persona: null,
    unread: false,
    selectable: false,
    // Nothing in a simulation has a verdict door to write through, so the row
    // does not offer one. A green Accept that decides nothing is worse than no
    // Accept at all — see `useSimulatedRail`'s note in ActivityRail.
    decidable: false,
    groupHeader: null,
    showTime: false,
    tracksRead: false,
    showKind: false,
  };
}

function dispatchRow(i: number, label: string, rand: Rand): RailRow {
  return {
    id: `sim-rail-dispatch-${i}`,
    tone: 'accent',
    code: 'DSP',
    kind: label,
    icon: Inbox,
    title: pick(rand, DISPATCH_TITLES),
    source: pick(rand, PROJECT_NAMES),
    at: new Date(Date.now() - int(rand, 30, 6_000) * 60_000).toISOString(),
    body: null,
    accent: null,
    persona: null,
    unread: false,
    selectable: false,
    decidable: false,
    groupHeader: null,
    showTime: false,
    tracksRead: false,
    showKind: true,
  };
}

function messageRow(i: number, project: string, first: boolean, label: string, rand: Rand): RailRow {
  return {
    id: `sim-rail-message-${i}`,
    tone: pick(rand, ['neutral', 'neutral', 'success', 'warning'] as const),
    code: 'MSG',
    kind: label,
    icon: pick(rand, [MessageSquare, FileText]),
    title: pick(rand, MESSAGE_TITLES),
    source: `${project} · ${pick(rand, ROLE_NAMES)}`,
    at: Date.now() - int(rand, 1, 900) * 60_000,
    body: null,
    accent: pick(rand, TEAM_COLORS),
    persona: null,
    unread: i < 6,
    selectable: false,
    decidable: false,
    // Grouped by project, header on the first row of each run — the same
    // contract `channelRowsByProject` fills in on the real path.
    groupHeader: first ? project : null,
    showTime: true,
    tracksRead: true,
    showKind: false,
  };
}

/**
 * Enough rows that every tab pages at least once (`useWindow` takes 30 at a
 * time), so the rail's infinite-load path is exercised rather than described.
 */
export function buildSimRail(labels: SimRailLabels): SimRailRows {
  const rand = mulberry32(SEED.rail);
  const reviews = Array.from({ length: 46 }, (_, i) => reviewRow(i, labels.review, rand));
  const dispatch = Array.from({ length: 18 }, (_, i) => dispatchRow(i, labels.dispatch, rand));

  const messages: RailRow[] = [];
  PROJECT_NAMES.slice(0, 9).forEach((project) => {
    const n = int(rand, 2, 6);
    for (let k = 0; k < n; k += 1) {
      messages.push(messageRow(messages.length, project, k === 0, labels.message, rand));
    }
  });

  return { reviews, dispatch, messages };
}
