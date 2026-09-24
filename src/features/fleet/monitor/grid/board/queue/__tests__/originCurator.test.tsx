// `DispatchOrigin` is mirrored by HAND in FOUR places — the Rust enum with its
// `token`/`parse`, the `ORIGINS` allowlist in `useQueueModel`, the switch in
// `originLabel`, and `ORIGIN_GLYPH` in `nodeSymbols`.
//
// Only the last fails loudly: it is an exhaustive `Record`, so tsc catches a
// missing variant (and a runtime miss throws, which is how it was found). The
// middle two fall back to `manual`, so a variant that reaches only some of
// them does not show up as an unknown origin — it shows up as the OPERATOR'S
// own dispatch, on the one board that exists to tell producers apart, and
// nothing anywhere fails. That is what this file is for: it asserts the
// frontend mirrors on a row Curator dispatched, and asserts the wrong answer
// is not the one rendered.
//
// The Rust half of the same trap is
// `commands::fleet::queue::tests::a_curator_dispatch_is_stored_and_read_back_as_hers`.

import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import type { FleetSession } from '@/lib/bindings/FleetSession';
import { QueueTile } from '../QueueTile';
import { SessionTile } from '../../../SessionTile';
import { asOrigin } from '../useQueueModel';
import type { QueueItem } from '../useQueueModel';
import type { QueueActions } from '../useQueueActions';

const NOW = Date.now();

// A fixture, not a wire payload: only the fields the tiles read are real, and
// the cast names that.
function session(o: Partial<FleetSession> = {}): FleetSession {
  return {
    id: 's1', title: 'Deepen conformance-checking', name: null, projectLabel: 'ai-registry',
    cwd: '/x', state: 'running', createdAtMs: BigInt(NOW - 5 * 60_000), origin: 'curator',
    ...o,
  } as unknown as FleetSession;
}

function item(o: Partial<QueueItem> = {}): QueueItem {
  const s = session({ id: 'q1', state: 'queued', ...(o.session ?? {}) });
  return {
    sessionId: s.id, session: s, rank: 1, origin: 'curator', personaId: null, goalId: null,
    projectLabel: s.projectLabel, locked: false, estimatedStartMs: null, notBeforeMs: null,
    ...o,
  };
}

const actions = {} as unknown as QueueActions;

describe('a session Curator dispatched', () => {
  // Mirror 2: the `ORIGINS` allowlist. A token that is not in it is narrowed
  // to `manual` on the way in, before any label is ever chosen.
  it('survives the origin allowlist instead of being narrowed to manual', () => {
    expect(asOrigin('curator')).toBe('curator');
    expect(asOrigin('kurator')).toBe('manual');
    expect(asOrigin(null)).toBe('manual');
  });

  // Mirror 3: the `originLabel` switch, driven through the real translations
  // exactly as the board drives it.
  it('names Curator in the classic board tile, and not the operator', () => {
    render(<SessionTile session={session()} width={172} height={44} />);
    const name = screen.getByTestId('fleet-grid-session').getAttribute('aria-label') ?? '';
    expect(name).toContain('Dispatched by Curator');
    expect(name).not.toContain('Dispatched by Manual');
    expect(screen.getByTestId('fleet-queue-origin').dataset.origin).toBe('curator');
  });

  it('names Curator on the queued row too', () => {
    render(<QueueTile item={item()} actions={actions} />);
    const tile = screen.getByTestId('fleet-queue-tile');
    const named = [...tile.querySelectorAll('[aria-label]')]
      .map((e) => e.getAttribute('aria-label') ?? '')
      .join('\n');
    expect(named).toContain('Dispatched by Curator');
    expect(named).not.toContain('Dispatched by Manual');
  });

  // The control: the same two tiles on an origin that IS the operator's still
  // say so. Without this, a test that asserted only "not manual" would pass
  // against a label function that had stopped saying manual at all.
  it('still names the operator for a manual dispatch', () => {
    render(<SessionTile session={session({ id: 's2', origin: 'manual' })} width={172} height={44} />);
    expect(screen.getByTestId('fleet-grid-session').getAttribute('aria-label') ?? '')
      .toContain('Dispatched by Manual');
  });
});
