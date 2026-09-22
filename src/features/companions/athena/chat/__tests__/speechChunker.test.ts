import { describe, expect, it } from 'vitest';
import { createSpeechChunker } from '../speechChunker';

/** Feed a full text in `step`-char increments, collecting every yield. */
function stream(text: string, step = 3): string[] {
  const chunker = createSpeechChunker();
  const out: string[] = [];
  for (let i = step; i < text.length + step; i += step) {
    out.push(...chunker.push(text.slice(0, i)));
  }
  return out;
}

describe('createSpeechChunker', () => {
  it('yields each completed sentence once as the snapshot grows', () => {
    expect(stream('First one. Second one! Third one? Still typing')).toEqual([
      'First one.',
      'Second one!',
      'Third one?',
    ]);
  });

  it('never yields the trailing incomplete sentence', () => {
    const chunker = createSpeechChunker();
    expect(chunker.push('Hello there')).toEqual([]);
    expect(chunker.push('Hello there.')).toEqual([]);
    expect(chunker.push('Hello there. ')).toEqual(['Hello there.']);
  });

  it('does not double-yield a span across repeated identical snapshots', () => {
    const chunker = createSpeechChunker();
    expect(chunker.push('Done. ')).toEqual(['Done.']);
    expect(chunker.push('Done. ')).toEqual([]);
    expect(chunker.push('Done. And more. ')).toEqual(['And more.']);
  });

  it('strips machine lines and treats them as a paragraph break', () => {
    const text = [
      'Sure thing',
      'OP: {"op":"navigate","target":"vault"}',
      'PROGRESS: opening the vault',
      '{"op":"noop"}',
      'QR: Yes | No',
      'TTS: Sure thing, opening the vault now.',
      'All set. ',
    ].join('\n');
    expect(stream(text, 5)).toEqual(['Sure thing', 'All set.']);
  });

  it('skips a machine line while it is still incomplete', () => {
    const chunker = createSpeechChunker();
    expect(chunker.push('Okay. \nOP')).toEqual(['Okay.']);
    expect(chunker.push('Okay. \nOP: {"op":"x","text":"Hi. There')).toEqual([]);
    expect(chunker.push('Okay. \nOP: {"op":"x","text":"Hi. There"}\nFine. ')).toEqual(['Fine.']);
  });

  it('ends a paragraph at a blank line even without a terminator', () => {
    expect(stream('Here is the list:\n\n- one\n- two\n\nEnjoy. ', 4)).toEqual([
      'Here is the list:',
      '- one - two',
      'Enjoy.',
    ]);
  });

  it('keeps abbreviations, initials and decimals inside a sentence', () => {
    expect(stream('Use a scanner, e.g. Sentry, or i.e. the log. Dr. J. Smith costs 3.5 units. Ok. ')).toEqual([
      'Use a scanner, e.g. Sentry, or i.e. the log.',
      'Dr. J. Smith costs 3.5 units.',
      'Ok.',
    ]);
  });

  it('honours closing quotes and brackets after the terminator', () => {
    expect(stream('She said "go." (Really.) Next ')).toEqual(['She said "go."', '(Really.)']);
  });

  it('resets when the snapshot is not a continuation (a new turn)', () => {
    const chunker = createSpeechChunker();
    expect(chunker.push('Old turn. Half way')).toEqual(['Old turn.']);
    expect(chunker.push('')).toEqual([]);
    expect(chunker.push('New turn. ')).toEqual(['New turn.']);
    expect(chunker.push('New turn. Tail')).toEqual([]);
  });

  it('flush yields the unspoken tail once and then starts clean', () => {
    const chunker = createSpeechChunker();
    expect(chunker.push('Spoken already. Last words without a newline')).toEqual([
      'Spoken already.',
    ]);
    expect(chunker.flush()).toEqual(['Last words without a newline']);
    expect(chunker.flush()).toEqual([]);
    expect(chunker.push('Fresh. ')).toEqual(['Fresh.']);
  });

  it('flush ignores a trailing machine line', () => {
    const chunker = createSpeechChunker();
    chunker.push('Prose done. \nTTS: Prose done.');
    expect(chunker.flush()).toEqual([]);
  });
});
