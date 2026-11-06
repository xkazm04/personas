/**
 * The Standup page's view model (spark app-standup, WP4): what the B/1
 * "Timetable" draws, derived from the wire types by `buildView`. Every
 * component reads these shapes, never the raw `Standup`, so the three lives
 * (decide, armed/running, return) and the fixture all render through one path.
 */
import type { DirectionProposal } from '@/lib/bindings/DirectionProposal';
import type { ParkedAsk } from '@/lib/bindings/ParkedAsk';
import type { StandupEventKind } from '@/lib/bindings/StandupEventKind';
import type { StandupStatus } from '@/lib/bindings/StandupStatus';

/** Where a row sits in the B/1 table. */
export type GroupId = 'decide' | 'agents' | 'waits' | 'blank' | 'filler' | 'refused';

/**
 * The one state a row shows in its decision column. PROPOSED, DECIDED and
 * RUNNING are the three that must never be confusable (dashed amber / solid
 * primary / hatched green); the rest are quieter.
 */
export type RowState =
  | 'proposed' // Athena's directions wait for a pick
  | 'decided' // picked or typed; not running
  | 'running' // armed and a session for it runs now
  | 'done' // armed and its forecast slot is behind the clock
  | 'skipped' // off tonight
  | 'waits' // a parked ask only the operator can answer
  | 'blank' // no proposal: the operator types the direction
  | 'filler' // fills dead spots
  | 'refused'; // held elsewhere (a headless master owns the project)

export type RowKind = 'direction' | 'agent' | 'hold' | 'filler';

/** One standup in a project's history strip. */
export type TickState = 'armed' | 'off' | 'none';

/** One away act placed on a time axis (pos 0..1 inside its window). */
export interface EventMark {
  id: string;
  kind: StandupEventKind;
  at: number;
  pos: number;
  summary: string;
}

/** Tone of a block on the tonight axis; PROPOSED is only ever a dashed outline. */
export type BlockTone = 'proposed' | 'decided' | 'running' | 'done' | 'filler';

export interface TimeBlock {
  id: string;
  start: number; // 0..1 inside the tonight window
  end: number;
  tone: BlockTone;
}

export interface RowView {
  key: string;
  kind: RowKind;
  group: GroupId;
  itemId?: string;
  projectId?: string;
  name: string;
  state: RowState;
  /** The decided text, the ask summary or the agent change's name. */
  headline: string;
  /** Athena's one-line read: the item's evidence, the change's why. */
  evidence: string;
  proposals: DirectionProposal[];
  /** Index of the picked proposal, -1 when none (or the text was edited). */
  chosenIndex: number;
  /** The last standups for this project, oldest first; null when not recorded. */
  history: TickState[] | null;
  pastMarks: EventMark[];
  nightMarks: EventMark[];
  /** Commits that landed for the project since the last standup (report). */
  moved: number;
  blocks: TimeBlock[];
  refusal?: string;
  ask?: ParkedAsk;
  agentVerb?: 'create' | 'retune';
}

export interface RowGroup {
  id: GroupId;
  rows: RowView[];
}

export interface Counts {
  waits: number;
  proposed: number;
  decided: number;
  running: number;
  refused: number;
}

export interface Window {
  from: number;
  to: number;
}

/** One past bin of the machine row: CPU share and whether any agent ran. */
export interface MachineBar {
  pos: number;
  width: number;
  cpu: number;
  busy: boolean;
}

export interface LaneBlock extends TimeBlock {
  lane: number;
}

export interface MachineView {
  bars: MachineBar[];
  /** Share of the past window with no host sample at all. */
  unrecorded: number;
  lanes: number;
  laneBlocks: LaneBlock[];
  /** Share of lane-time tonight with nothing scheduled. */
  deadShare: number;
  peakUnits: number;
}

export interface SinceLast {
  sinceMs: number;
  moved: number;
  projects: number;
  parked: number;
  running: number;
  created: string[];
}

/** decide = draft; armed = the plan runs; return = armed with a report to read. */
export type Life = 'none' | 'decide' | 'armed' | 'return' | 'ended';

export interface StandupView {
  id: string | null;
  status: StandupStatus | 'none';
  life: Life;
  revision: number;
  nowMs: number;
  past: Window;
  night: Window;
  groups: RowGroup[];
  /** Every selectable row, in table order (the j/k list). */
  rows: RowView[];
  counts: Counts;
  machine: MachineView;
  sinceLast: SinceLast | null;
  /** Directions that will run, and their forecast runs. */
  plannedDirections: number;
  plannedRuns: number;
}
