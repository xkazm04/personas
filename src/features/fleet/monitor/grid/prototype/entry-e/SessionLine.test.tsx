/**
 * The session line (WP11 C) in the persona line's anatomy: a flat 36px
 * `.ae-line` (never the old pile tile or puck), state as lamp plus edge, the
 * testids, recap and keyboard open it always had, the token drop order as
 * structure (jsdom has no layout), and the tooltip/aria sentence.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render } from '@testing-library/react';
import type { FleetSession } from '@/lib/bindings/FleetSession';
import { SessionLine, SESSION_LINE_H } from './SessionLine';
import { PERSONA_LINE_H } from './PersonaLine';

const NOW = Date.parse('2026-10-16T10:00:00Z');

function session(o: Partial<FleetSession> = {}): FleetSession {
  return {
    id: 's1', title: 'Write ADR for the queue', name: null, projectLabel: 'personas', cwd: '/x', state: 'idle',
    createdAtMs: BigInt(NOW - 3 * 3_600_000), origin: 'dev_runner', exitCode: null,
    ...o,
  } as unknown as FleetSession;
}

function line(s: FleetSession, extra: { showProject?: boolean; onOpen?: (s: FleetSession) => void; onRecap?: (s: FleetSession) => void } = {}) {
  const { container } = render(
    <SessionLine session={s} onOpen={extra.onOpen} onRecap={extra.onRecap ?? (() => undefined)} now={NOW} showProject={extra.showProject} />,
  );
  return container.querySelector<HTMLElement>('[data-testid="fleet-grid-session"]')!;
}

afterEach(cleanup);

describe('SessionLine: the persona line\'s anatomy', () => {
  it('is one flat line of the persona line\'s height, with no tile, puck or age bar', () => {
    const el = line(session());
    expect(SESSION_LINE_H).toBe(PERSONA_LINE_H);
    expect(el.style.height).toBe(`${PERSONA_LINE_H}px`);
    expect(el.className).toMatch(/\bae-line\b/);
    expect(el.className).not.toMatch(/\bfb-tile\b|\bae-pile\b/);
    expect(el.querySelector('.ae-puck, .fb-age')).toBeNull();
    expect(el.querySelector('.ae-lamp')).not.toBeNull();
  });

  it('a running line keeps the run edge, the sweep and a lit lamp', () => {
    const el = line(session({ state: 'running' }));
    expect(el.className).toMatch(/\bis-working\b/);
    expect(el.className).toMatch(/\bae-sweep\b/);
    expect(el.querySelector('.ae-lamp')!.className).toMatch(/\bis-lit\b/);
    expect(el.querySelector('[data-testid="session-line-word"]')).toBeNull();
  });

  it('awaiting input lights the edge; a failed exit is critical', () => {
    expect(line(session({ state: 'awaiting_input' })).className).toMatch(/\bis-lit\b/);
    cleanup();
    expect(line(session({ state: 'exited', exitCode: 2 })).className).toMatch(/\bis-lit\b.*\bis-critical\b/);
  });
});

describe('SessionLine: token drop order', () => {
  it('keeps the state glyph beside the title, and puts the word then the project in the slot that leaves first', () => {
    const el = line(session(), { showProject: true });
    const [, head, slot] = Array.from(el.children) as HTMLElement[];
    expect(head!.className).toMatch(/\bflex-wrap\b.*\boverflow-hidden\b/);
    expect(head!.children[0]!.textContent).toBe('Write ADR for the queue');
    expect((head!.children[1] as HTMLElement).dataset.testid).toBe('session-line-state');
    expect(slot!.className).toMatch(/\bflex-1\b/);
    expect((slot!.firstElementChild as HTMLElement).className).toMatch(/\bw-0\b/);
    const toks = Array.from(slot!.children).slice(1) as HTMLElement[];
    expect(toks[0]!.dataset.testid).toBe('session-line-word');
    expect(toks[1]!.textContent).toBe('personas');
    for (const t of toks) expect(t.className).toMatch(/\bwhitespace-nowrap\b.*|\bflex-shrink-0\b/);
  });

  it('draws no slot in a project bay for a running line (nothing to drop)', () => {
    const el = line(session({ state: 'running' }));
    expect(el.querySelector('[data-testid="session-line-word"]')).toBeNull();
    expect(Array.from(el.children).some((c) => (c as HTMLElement).className.includes('flex-1') && c.querySelector('.w-0'))).toBe(false);
  });

  it('the age is the right-edge figure', () => {
    expect(line(session()).querySelector('[data-testid="session-line-age"]')!.textContent).toBe('3h');
  });
});

describe('SessionLine: sentence, open and recap', () => {
  it('carries the whole sentence as its accessible name', () => {
    const label = line(session(), { showProject: true }).getAttribute('aria-label')!;
    expect(label).toMatch(/^Write ADR for the queue · /);
    expect(label).toContain('personas');
    expect(label).toContain('3h');
  });

  it('opens on Enter and keeps the recap button, which does not open the line', () => {
    const onOpen = vi.fn();
    const onRecap = vi.fn();
    const el = line(session(), { onOpen, onRecap });
    fireEvent.keyDown(el, { key: 'Enter' });
    expect(onOpen).toHaveBeenCalledTimes(1);
    fireEvent.click(el.querySelector('[data-testid="fleet-grid-session-recap"]')!);
    expect(onRecap).toHaveBeenCalledTimes(1);
    expect(onOpen).toHaveBeenCalledTimes(1);
  });

  it('an ended session without a terminal is inert', () => {
    const el = line(session({ state: 'exited', exitCode: 0 }));
    expect(el.getAttribute('role')).toBe('img');
    expect(el.className).toMatch(/\bis-inert\b/);
  });
});
