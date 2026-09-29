import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render } from '@testing-library/react';

// The agent Studio writes into every project (src-tauri/src/webbuild/
// athena_preview_agent.tsx, embedded by preview_agent.rs). It runs inside the
// preview frame; here the frame is the jsdom window, so window.parent is the
// window itself and its postMessage is what the host would receive.

const { AthenaPreviewAgent, selectorFor, labelFor, componentOf, frameChain, step } = await import(
  '../../../../src-tauri/src/webbuild/athena_preview_agent'
);

let post: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  document.body.innerHTML = `
    <main>
      <section class="pricing">
        <div class="card"><h3>Basic</h3><button>Choose</button></div>
        <div class="card"><h3>Pro $19</h3><button aria-label="Choose Pro">Choose</button></div>
      </section>
      <img id="hero-photo" alt="Fresh bread on a board" src="x.png" />
    </main>`;
  post = vi.spyOn(window, 'postMessage').mockImplementation(() => {});
});
afterEach(() => {
  cleanup();
  post.mockRestore();
});

const sent = (type: string) =>
  post.mock.calls.map((c) => c[0] as Record<string, unknown>).filter((m) => m.type === type);
const card = (i: number) => document.querySelectorAll('.card')[i]! as HTMLElement;
const tell = (data: Record<string, unknown>) =>
  window.dispatchEvent(new MessageEvent('message', { data: { source: 'athena', ...data } }));
const key = (k: string) => window.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true }));
/** Give an element React's dev fiber, as a component's outermost element has it. */
function asComponentRoot(el: Element, name: string) {
  function Component() {}
  Object.defineProperty(Component, 'name', { value: name });
  (el as unknown as Record<string, unknown>)['__reactFiber$test'] = { type: 'div', return: { type: Component, return: null } };
}

describe('naming what the owner points at', () => {
  it('a selector that finds the element again, and a label a person would use', () => {
    const h3 = card(1).querySelector('h3')!;
    expect(document.querySelector(selectorFor(h3))).toBe(h3);
    expect(selectorFor(document.getElementById('hero-photo')!)).toBe('#hero-photo');
    expect(labelFor(document.getElementById('hero-photo')!)).toBe('Fresh bread on a board');
    expect(labelFor(document.querySelector('[aria-label="Choose Pro"]')!)).toBe('Choose Pro');
    const long = document.createElement('p');
    long.textContent = 'word '.repeat(40);
    expect(labelFor(long).length).toBeLessThanOrEqual(60);
  });

  it('the component frames around it come from React, outermost first; framework wrappers are skipped', () => {
    asComponentRoot(card(1), 'PricingCard');
    asComponentRoot(document.querySelector('.pricing')!, 'Pricing');
    asComponentRoot(document.querySelector('main')!, 'InnerLayoutRouter');
    const h3 = card(1).querySelector('h3')!;
    expect(componentOf(card(1))).toBe('PricingCard');
    expect(componentOf(h3)).toBeNull();
    expect(frameChain(h3).map((f) => f.name)).toEqual(['Pricing', 'PricingCard', 'h3']);
  });
});

describe('moving through the page', () => {
  it('out to the wrapper, in to the child, across to siblings', () => {
    const h3 = card(1).querySelector('h3')!;
    expect(step(h3, 'out')).toBe(card(1));
    expect(step(card(1), 'in')).toBe(h3);
    expect(step(card(1), 'prev')).toBe(card(0));
    expect(step(card(0), 'next')).toBe(card(1));
  });

  it('a wrapper with exactly the same box is skipped, so every step is visible', () => {
    const inner = card(1).querySelector('h3')!;
    const box = { x: 10, y: 20, width: 100, height: 30, top: 20, left: 10, right: 110, bottom: 50, toJSON: () => ({}) } as DOMRect;
    vi.spyOn(inner, 'getBoundingClientRect').mockReturnValue(box);
    vi.spyOn(card(1), 'getBoundingClientRect').mockReturnValue(box);
    expect(step(inner, 'out')).toBe(document.querySelector('.pricing'));
  });
});

describe('inspect mode', () => {
  it('a right-click chooses the element instead of opening the browser menu', () => {
    render(<AthenaPreviewAgent />);
    const h3 = card(1).querySelector('h3')!;
    const ev = new MouseEvent('contextmenu', { bubbles: true, cancelable: true });
    h3.dispatchEvent(ev);
    expect(ev.defaultPrevented).toBe(true);
    const [msg] = sent('picked');
    expect(msg).toMatchObject({ source: 'athena-agent', type: 'picked', label: 'Pro $19', tag: 'h3', path: '/' });
    expect(document.querySelector(String(msg!.selector))).toBe(h3);
    expect(sent('inspect').at(-1)).toMatchObject({ on: true });
  });

  it('keys move out and in and report each new target; clicks choose instead of navigating; Esc leaves', () => {
    render(<AthenaPreviewAgent />);
    tell({ type: 'inspect', on: true });
    const h3 = card(1).querySelector('h3')!;
    const click = new MouseEvent('click', { bubbles: true, cancelable: true });
    h3.dispatchEvent(click);
    expect(click.defaultPrevented).toBe(true);
    key('[');
    expect(sent('picked').at(-1)!.tag).toBe('div');
    key(']');
    expect(sent('picked').at(-1)!.tag).toBe('h3');
    tell({ type: 'inspect-move', dir: 'out' });
    expect(document.querySelector(String(sent('picked').at(-1)!.selector))).toBe(card(1));
    key('Escape');
    expect(sent('inspect').at(-1)).toMatchObject({ on: false });
    const after = new MouseEvent('click', { bubbles: true, cancelable: true });
    h3.dispatchEvent(after);
    expect(after.defaultPrevented).toBe(false);
  });

  it('draws the frames inside the page while inspecting, and removes them on leaving', () => {
    render(<AthenaPreviewAgent />);
    tell({ type: 'inspect', on: true });
    card(1).querySelector('h3')!.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));
    expect(document.getElementById('__athena-inspect')?.childElementCount).toBeGreaterThan(0);
    tell({ type: 'inspect', on: false });
    expect(document.getElementById('__athena-inspect')).toBeNull();
  });
});
