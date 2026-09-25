/**
 * The bench's two materials: the operator's intakes and her plan rows.
 *
 * THE ONE RULE, CARRIED INTO THE QUEUE. The shipped ledger already holds that a
 * count, a measured zero, an unknown and an unmeasurable are four different
 * facts. This variant applies the same law to the thing the operator actually
 * touches: what the cheap pre-read pass knows about a resource he pasted.
 * `Read` is that closed vocabulary, and nothing downstream may collapse it.
 *
 * A row therefore carries TWO independent honesty axes and they are drawn in
 * two different places: where the REQUEST stands (six states, on the spine as a
 * Mark) and what is KNOWN ABOUT THE RESOURCE (four facts, inline where the
 * topic goes). A landed request whose resource could never be read is a real
 * combination, and a surface that fused the two axes could not draw it.
 */
import type { ChannelId } from '../../../model/channels';

/** `CuratorRequestState`, restated here so the fixture needs no backend. */
export type RequestState = 'queued' | 'dispatched' | 'landed' | 'declined' | 'failed' | 'cancelled';

/** What the pre-read pass knows about one resource. Four facts, never three. */
export type Read =
  /** It read the resource and named it. */
  | { kind: 'read'; topic: string; domain: string }
  /** It read the resource and there was no topic in it. A measured zero. */
  | { kind: 'nothing' }
  /** Nobody has looked yet. Not a zero, and not inside any count. */
  | { kind: 'unread'; why: 'pending' | 'capped' }
  /** It ran and had nothing to work from: the fetch never produced a document. */
  | { kind: 'unreadable'; why: string };

export interface Intake {
  id: string;
  /** The registry skill. */
  skill: string;
  /** The target, as he pasted it. */
  url: string;
  note: string | null;
  state: RequestState;
  read: Read;
  /** ISO stamp of the moment he pressed File. */
  filedAt: string;
  /** The run's own words once it has any: a failure reason, then an outcome. */
  say: string | null;
}

/** One row of her plan, compressed for half a page. */
export interface PlanRow {
  id: string;
  domain: string;
  slug: string;
  points: number;
  /** Which of the nine scored, and for how much. The reason stays itself. */
  marks: ReadonlyArray<{ channel: ChannelId; points: number }>;
  state: 'planned' | 'dispatched' | 'landed' | 'declined' | 'idled' | 'blocked';
}

/** One bundle, as the join between the two columns needs it. */
export interface Bundle {
  domain: string;
  /** Whether consumers report demand here. Where they do not, 1 and 7 are unknown. */
  demandKnown: boolean;
}
