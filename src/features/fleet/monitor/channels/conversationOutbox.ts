/* ── THE COMPOSER QUEUE (plan Lane A, "submit-while-busy = enqueue") ───────── */

/**
 * One thing the operator typed and pressed Enter on, before the channel was
 * ready to take it.
 *
 * The composer never disables. A prompt typed while a directive or a route is
 * in flight becomes one of these — a VISIBLE row at the bottom of the
 * conversation, in its own phase — and drains in order. The alternative the
 * surface shipped with was a greyed-out button, which loses the thought and
 * tells the operator to wait on a machine.
 */
export interface QueuedPrompt {
  /** Client id. Never leaves the browser — the server row is matched by the
   *  refetch that follows a successful post, not by this. */
  id: string;
  text: string;
  /** A goal ROUTES (decompose → proposal card); a plain prompt POSTS. */
  goal: boolean;
  phase: 'queued' | 'sending' | 'failed';
  /** Runs once, after the directive this prompt rode in on was POSTED. Never
   *  on a failed post, and never at enqueue time: a follow-on side effect (the
   *  @athena handoff) must not announce a line that is not in the channel. */
  onPosted?: () => void;
}

/** What the drain should do next: one post, covering one or more prompts. */
export interface PromptBatch {
  ids: string[];
  body: string;
  goal: boolean;
  /** The `onPosted` hooks of every prompt folded into this batch. */
  afterPost: Array<() => void>;
}

/**
 * The fold rule.
 *
 * Two plain prompts typed back to back are one thought split across two
 * keystrokes' worth of patience — posting them as two directives makes the team
 * answer twice, so the BODY combines while the DISPLAY stays two rows. A goal
 * never folds: routing is a decomposition of one goal, and concatenating two
 * would produce a plan for neither.
 *
 * Returns `null` when there is nothing to do, which includes the case that
 * matters most: something is already in flight. A `failed` entry is skipped
 * rather than retried — it is a row the operator now owns — and it BREAKS a
 * run, because the two prompts either side of it were never one body.
 */
export function nextPromptBatch(queue: QueuedPrompt[]): PromptBatch | null {
  if (queue.some((p) => p.phase === 'sending')) return null;
  const head = queue.findIndex((p) => p.phase === 'queued');
  if (head < 0) return null;
  const first = queue[head]!;
  if (first.goal) return { ids: [first.id], body: first.text, goal: true, afterPost: first.onPosted ? [first.onPosted] : [] };

  const run: QueuedPrompt[] = [];
  for (let i = head; i < queue.length; i++) {
    const p = queue[i]!;
    if (p.phase !== 'queued' || p.goal) break;
    run.push(p);
  }
  return { ids: run.map((p) => p.id), body: run.map((p) => p.text).join('\n\n'), goal: false,
    afterPost: run.flatMap((p) => (p.onPosted ? [p.onPosted] : [])),
  };
}
