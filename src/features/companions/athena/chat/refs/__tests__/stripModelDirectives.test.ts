import { describe, expect, it } from 'vitest';
import { stripModelDirectives } from '../../../athenaLabels';

describe('stripModelDirectives', () => {
  it('strips PROGRESS: lines like Rust clean_segment_for_display', () => {
    expect(stripModelDirectives('PROGRESS: checking the fleet\nAll three sessions are green.')).toBe(
      'All three sessions are green.',
    );
    expect(stripModelDirectives('Done.\n  PROGRESS: tail beat')).toBe('Done.');
  });

  it('still strips OP/QR/TTS and raw op JSON', () => {
    expect(stripModelDirectives('Hi.\nOP: {"op":"x"}\nQR: a | b\nTTS: hi\n{"op":"y"}')).toBe('Hi.');
  });
});
