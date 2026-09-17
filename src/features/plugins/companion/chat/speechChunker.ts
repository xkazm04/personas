/**
 * Streaming sentence chunker for spoken replies.
 *
 * The chat store holds the accumulated visible text of the running turn and
 * republishes it on every delta. This chunker takes those successive snapshots
 * and yields each newly COMPLETED sentence exactly once, so speech can start
 * on the first sentence instead of waiting for the whole reply (the voice
 * contract in `docs/architecture/hybrid-llm-engine.md`).
 *
 * Rules:
 *  - a sentence ends at `.`, `!` or `?` (plus closing quotes/brackets) that is
 *    followed by whitespace, or at a blank line (paragraph end);
 *  - machine lines (`OP:`, `QR:`, `PROGRESS:`, `TTS:`, a bare `{"op"`) are
 *    dropped and act as a paragraph break, even while still incomplete;
 *  - the trailing incomplete sentence is never yielded during streaming; the
 *    caller's `flush()` at turn end yields it;
 *  - common abbreviations (`e.g.`, `i.e.`, `Dr.`, single initials, ...) and
 *    decimals (`3.5`) do not end a sentence;
 *  - a snapshot that is not a continuation of the previous one (a new turn, an
 *    interrupted turn) resets the cursor.
 *
 * Pure: no store, no timers, no DOM.
 */

export interface SpeechChunker {
  /** Feed the latest accumulated snapshot; returns newly completed sentences. */
  push(text: string): string[];
  /** The turn is over: yield whatever prose is still unspoken, then reset. */
  flush(): string[];
  /** Forget everything (a new turn is about to start). */
  reset(): void;
}

const MACHINE_LINE = /^\s*(?:OP:|QR:|PROGRESS:|TTS:|\{"op")/;
/** Sentence end (terminator + closers + whitespace) OR a blank line. */
const BOUNDARY = /[.!?]+["')\]]*\s+|\n[ \t]*\n/g;
/** Tokens that end in a period without ending a sentence. */
const ABBREVIATIONS = /^(?:e\.g|i\.e|etc|vs|cf|approx|mr|mrs|ms|dr|prof|sr|jr|st|no|[a-z])\.$/i;

/**
 * The prose the chunker reasons about: the snapshot with every machine line
 * blanked (its newline kept, so it reads as a paragraph break). Deterministic
 * in the snapshot, and prefix-stable as the snapshot grows, because a machine
 * prefix is shorter than anything that could have been yielded from that line.
 */
function toProse(text: string): string {
  return text
    .split('\n')
    .map((line) => (MACHINE_LINE.test(line) ? '' : line))
    .join('\n');
}

function endsSentence(prose: string, from: number, matchIndex: number, match: string): boolean {
  if (match.startsWith('\n')) return true;
  const terminatorLen = match.replace(/\s+$/, '').length;
  const head = prose.slice(from, matchIndex + terminatorLen);
  const token = /(\S+)$/.exec(head)?.[1] ?? '';
  return !ABBREVIATIONS.test(token);
}

function speakable(raw: string): string {
  return raw.replace(/\s+/g, ' ').trim();
}

export function createSpeechChunker(): SpeechChunker {
  let previous = '';
  let prose = '';
  let consumed = 0;

  const reset = (): void => {
    previous = '';
    prose = '';
    consumed = 0;
  };

  const push = (text: string): string[] => {
    if (!text.startsWith(previous)) reset();
    previous = text;
    prose = toProse(text);
    const out: string[] = [];
    BOUNDARY.lastIndex = consumed;
    let m: RegExpExecArray | null;
    while ((m = BOUNDARY.exec(prose)) !== null) {
      const end = m.index + m[0].length;
      if (!endsSentence(prose, consumed, m.index, m[0])) continue;
      const sentence = speakable(prose.slice(consumed, end));
      if (sentence) out.push(sentence);
      consumed = end;
      BOUNDARY.lastIndex = consumed;
    }
    return out;
  };

  const flush = (): string[] => {
    const tail = speakable(prose.slice(consumed));
    reset();
    return tail ? [tail] : [];
  };

  return { push, flush, reset };
}
