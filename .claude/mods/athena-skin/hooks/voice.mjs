// Athena's words for the spinner and the turn line. Pure: the hooks module and the tests import it.
// Plain verbs of attention, no cooking and no cheer; the tone of her companion voice.

export const ACCENT = '#38bdf8' // the "Athena is on it" light blue in src/styles/globals.css (fleet-attn-athena)

const WORDS = {
  thinking: ['Weighing', 'Recalling', 'Tracing', 'Considering'],
  requesting: ['Reaching'],
  'tool-use': ['Working through it', 'Checking', 'Following the thread'],
  'tool-input': ['Preparing'],
  responding: ['Composing', 'Setting it down'],
}
const DONE = ['Settled', 'Resolved', 'Concluded']

// A stable pick per row, so a redraw never changes the word under the person's eye.
function pick(list, seed) {
  let h = 0
  for (const c of String(seed)) h = (h * 31 + c.charCodeAt(0)) >>> 0
  return list[h % list.length]
}

export const spinnerWord = (mode, seed) => pick(WORDS[mode] ?? WORDS.thinking, seed)
export const doneWord = seed => pick(DONE, seed)

/** The orb: a quarter turn per second while she works, a still ring when she rests. */
export function orb(working, nowMs) {
  if (!working) return '◌'
  return ['◐', '◓', '◑', '◒'][Math.floor(nowMs / 400) % 4]
}

export function summary(turn) {
  if (turn === null) return 'ready'
  const s = turn.seconds >= 60 ? `${Math.floor(turn.seconds / 60)}m ${turn.seconds % 60}s` : `${turn.seconds}s`
  return `last turn ${s}, ${turn.tools} ${turn.tools === 1 ? 'tool call' : 'tool calls'}`
}
