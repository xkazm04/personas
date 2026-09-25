/**
 * Which backend job is mine, and when is it over - as a pure reducer.
 *
 * An AI-artifact task (credential design, negotiator, automation design,
 * recipe execute/generate/version) follows a backend job it does not name up
 * front: the start command mints the id server-side and returns it, while the
 * job's events - every one of which carries that id under the task's
 * `id_field` (`ai_artifact_flow.rs` emit helpers) - can arrive BEFORE the
 * start result does. So the reducer:
 *
 *   - holds events until the id is known, then replays ours and drops the rest;
 *   - after that, applies only events that carry our id;
 *   - reads a foreign run's INITIAL status, seen after our own, as "our run was
 *     superseded": the single-slot domains (`begin_run` / `set_id`) stop the
 *     previous run without emitting any status for it, so without this the
 *     losing surface only ends when its watchdog fires;
 *   - turns deadline expiry into `timeout` plus a `cancelBackend` command, so a
 *     run the UI gave up on stops spending too.
 *
 * No React, no Tauri, no timers: `useTauriStream` is the thin driver that feeds
 * inputs and executes the commands.
 */

export type ArtifactPayload = Record<string, unknown>;

export interface ArtifactJobConfig {
  /**
   * The key the backend puts the job id under, in the start result and in
   * every event (the Rust `AiArtifactMessages.id_field`). `null` = no
   * correlation: every event is applied, as before this module existed.
   */
  idField: string | null;
  /** The status the backend emits first for a run (`AiArtifactMessages.initial_status`). */
  initialStatus: string;
}

export type ArtifactJobEvent =
  | { type: 'progress'; payload: ArtifactPayload }
  | { type: 'status'; payload: ArtifactPayload };

export type ArtifactJobInput =
  | ArtifactJobEvent
  /** The start command returned; `id` is null when its result carried none. */
  | { type: 'idKnown'; id: string | null }
  | { type: 'deadline' };

export type ArtifactJobCommand =
  /** A progress line of our job. */
  | { type: 'line'; payload: ArtifactPayload }
  /** A status of our job - the driver resolves it into result / error / ignore. */
  | { type: 'status'; payload: ArtifactPayload }
  | { type: 'superseded' }
  | { type: 'timeout' }
  | { type: 'cancelBackend' };

export interface ArtifactJobState {
  /** holding: id not known yet; correlated: filtering by id; passthrough: no id; over: ended here. */
  readonly mode: 'holding' | 'correlated' | 'passthrough' | 'over';
  readonly id: string | null;
  readonly held: readonly ArtifactJobEvent[];
  /** Our own initial status has been observed (orders a foreign one relative to ours). */
  readonly seenOwnInitial: boolean;
  /** Another run's event was observed in this domain after our id was known. */
  readonly sawForeign: boolean;
}

export interface ArtifactJobStep {
  state: ArtifactJobState;
  commands: ArtifactJobCommand[];
}

/**
 * Events that can arrive before the start result are the first few of a run
 * ("Connecting to Claude...", the initial status). The cap only bounds a
 * pathological start that never returns.
 */
const MAX_HELD = 200;

/** Slack past the backend's own timeout: the CLI is killed at the limit, then the runner still extracts and emits. */
export const ARTIFACT_DEADLINE_GRACE_MS = 30_000;

/** The frontend deadline for a job whose backend limit is `backendTimeoutSecs`. Never shorter than the backend's. */
export function artifactDeadlineMs(backendTimeoutSecs: number): number {
  return backendTimeoutSecs * 1000 + ARTIFACT_DEADLINE_GRACE_MS;
}

/** The job id in a start command's result, or null when it carries none. */
export function readJobId(startResult: unknown, idField: string): string | null {
  if (typeof startResult !== 'object' || startResult === null) return null;
  const id = (startResult as Record<string, unknown>)[idField];
  return typeof id === 'string' && id.length > 0 ? id : null;
}

export function initialArtifactJobState(config: ArtifactJobConfig): ArtifactJobState {
  return {
    mode: config.idField ? 'holding' : 'passthrough',
    id: null,
    held: [],
    seenOwnInitial: false,
    sawForeign: false,
  };
}

const OVER = (state: ArtifactJobState): ArtifactJobState => ({ ...state, mode: 'over', held: [] });

const toCommand = (event: ArtifactJobEvent): ArtifactJobCommand =>
  event.type === 'progress' ? { type: 'line', payload: event.payload } : event;

/** Route one event of a correlated job. */
function route(
  state: ArtifactJobState,
  event: ArtifactJobEvent,
  config: ArtifactJobConfig,
): ArtifactJobStep {
  const eventId = config.idField ? event.payload[config.idField] : undefined;
  const isInitial = event.type === 'status' && event.payload.status === config.initialStatus;

  if (eventId === state.id) {
    const next = isInitial && !state.seenOwnInitial ? { ...state, seenOwnInitial: true } : state;
    return { state: next, commands: [toCommand(event)] };
  }

  // A foreign run's first status, after ours: it replaced us. Before ours it is
  // the run WE replaced, and is simply not ours.
  if (isInitial && state.seenOwnInitial) {
    return { state: OVER(state), commands: [{ type: 'superseded' }] };
  }
  return { state: state.sawForeign ? state : { ...state, sawForeign: true }, commands: [] };
}

export function stepArtifactJob(
  state: ArtifactJobState,
  input: ArtifactJobInput,
  config: ArtifactJobConfig,
): ArtifactJobStep {
  if (state.mode === 'over') return { state, commands: [] };

  switch (input.type) {
    case 'deadline': {
      // With another run seen in the domain, the backend's current job may be
      // theirs - the cancel commands take no id - so only time out here.
      const commands: ArtifactJobCommand[] = state.sawForeign
        ? [{ type: 'timeout' }]
        : [{ type: 'timeout' }, { type: 'cancelBackend' }];
      return { state: OVER(state), commands };
    }

    case 'idKnown': {
      if (state.mode !== 'holding') return { state, commands: [] };
      if (input.id === null) {
        return { state: { ...state, mode: 'passthrough', held: [] }, commands: state.held.map(toCommand) };
      }
      let next: ArtifactJobState = { ...state, mode: 'correlated', id: input.id, held: [] };
      const commands: ArtifactJobCommand[] = [];
      for (const event of state.held) {
        const step = route(next, event, config);
        next = step.state;
        commands.push(...step.commands);
        if (next.mode === 'over') break;
      }
      // A foreign event held before our id was known predates our run's start
      // (or races it); it says nothing about who owns the backend slot NOW.
      return { state: next.mode === 'over' ? next : { ...next, sawForeign: false }, commands };
    }

    case 'progress':
    case 'status': {
      if (state.mode === 'passthrough') return { state, commands: [toCommand(input)] };
      if (state.mode === 'holding') {
        const held = state.held.length >= MAX_HELD ? [...state.held.slice(1), input] : [...state.held, input];
        return { state: { ...state, held }, commands: [] };
      }
      return route(state, input, config);
    }
  }
}
