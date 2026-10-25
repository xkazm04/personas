import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { AskWalkthroughRow, COMPOSE_TOPIC_MAX } from '../AskWalkthroughRow';

/**
 * The ask field must not accept a topic the backend refuses. The limit lives in
 * the Rust command, so the number is read from there rather than restated here:
 * a change on either side fails this test instead of drifting silently.
 */
function backendTopicLimit(): number {
  const src = readFileSync(resolve(process.cwd(), 'src-tauri/src/commands/companion/tours.rs'), 'utf8')
    .replace(/\/\/.*$/gm, '');
  // The cap counts characters (`topic.chars().count() > TOPIC_MAX_CHARS`), so the
  // number lives in the constant, not in the comparison.
  const m = /const\s+TOPIC_MAX_CHARS\s*:\s*usize\s*=\s*(\d+)/.exec(src);
  if (!m) throw new Error('companion_compose_tour topic limit not found - update this test');
  return Number(m[1]);
}

describe('AskWalkthroughRow topic limit', () => {
  it('caps the field at the limit companion_compose_tour enforces', () => {
    expect(COMPOSE_TOPIC_MAX).toBe(backendTopicLimit());
    render(<AskWalkthroughRow onComposed={() => {}} />);
    const input = screen.getByTestId('learning-ask-walkthrough-input') as HTMLInputElement;
    expect(input.maxLength).toBe(backendTopicLimit());
  });
});
