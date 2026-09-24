import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render } from '@testing-library/react';

// The agent Studio writes into every project (src-tauri/src/webbuild/
// athena_preview_agent.tsx, embedded by preview_agent.rs). It runs inside the
// preview frame; here the frame is the jsdom window, so window.parent is the
// window itself and its postMessage is what the host would receive.

const { AthenaPreviewAgent, selectorFor, labelFor } = await import(
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

const picked = () =>
  post.mock.calls.map((c) => c[0] as Record<string, unknown>).filter((m) => m.type === 'picked');

describe('the preview agent', () => {
  it('names an element with a selector that finds it again', () => {
    const second = document.querySelectorAll('.card')[1]!.querySelector('h3')!;
    expect(document.querySelector(selectorFor(second))).toBe(second);
    const img = document.getElementById('hero-photo')!;
    expect(selectorFor(img)).toBe('#hero-photo');
  });

  it('labels an element the way a person would', () => {
    expect(labelFor(document.getElementById('hero-photo')!)).toBe('Fresh bread on a board');
    expect(labelFor(document.querySelector('[aria-label="Choose Pro"]')!)).toBe('Choose Pro');
    const long = document.createElement('p');
    long.textContent = 'word '.repeat(40);
    expect(labelFor(long).length).toBeLessThanOrEqual(60);
  });

  it('a right-click reports the element instead of opening the browser menu', () => {
    render(<AthenaPreviewAgent />);
    const target = document.querySelectorAll('.card')[1]!.querySelector('h3')!;
    const ev = new MouseEvent('contextmenu', { bubbles: true, cancelable: true });
    target.dispatchEvent(ev);
    expect(ev.defaultPrevented).toBe(true);
    const [msg] = picked();
    expect(msg).toMatchObject({ source: 'athena-agent', type: 'picked', label: 'Pro $19', tag: 'h3', path: '/' });
    expect(document.querySelector(String(msg!.selector))).toBe(target);
  });

  it('in pick mode the next click picks, and only the next one', () => {
    render(<AthenaPreviewAgent />);
    window.dispatchEvent(new MessageEvent('message', { data: { source: 'athena', type: 'pickmode', on: true } }));
    const button = document.querySelector('button')!;
    const first = new MouseEvent('click', { bubbles: true, cancelable: true });
    button.dispatchEvent(first);
    expect(first.defaultPrevented).toBe(true);
    expect(picked()).toHaveLength(1);
    const second = new MouseEvent('click', { bubbles: true, cancelable: true });
    button.dispatchEvent(second);
    expect(second.defaultPrevented).toBe(false);
    expect(picked()).toHaveLength(1);
  });
});
