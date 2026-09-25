// Section e: font selection. Which faces the stacks name, which this machine
// actually has, and what the proposal names instead. Detection compares the
// rendered width of a test string against a generic fallback; a face that is
// neither installed nor loaded measures the same as the fallback.
import { useEffect, useState } from 'react';
import { Section, Split, type View } from '../parts';
import { SAMPLE } from '../specimenData';

const FACES = ['Inter', 'Segoe UI Variable Text', 'Segoe UI', 'JetBrains Mono', 'Fira Code', 'Cascadia Mono', 'Consolas', 'SF Mono'];

function available(face: string): boolean {
  const ctx = document.createElement('canvas').getContext('2d');
  if (!ctx) return false;
  const probe = 'mmmmmmmmmmlliWWW0O';
  return ['monospace', 'serif', 'sans-serif'].some((generic) => {
    ctx.font = `32px ${generic}`;
    const base = ctx.measureText(probe).width;
    ctx.font = `32px "${face}", ${generic}`;
    return ctx.measureText(probe).width !== base;
  });
}

export function FontSection({ view }: { view: View }) {
  const [found, setFound] = useState<Record<string, boolean>>({});
  useEffect(() => { setFound(Object.fromEntries(FACES.map((f) => [f, available(f)]))); }, []);
  return (
    <Section id="font" title="Font selection" note="Detected on this machine at render time.">
      <Split view={view}>
        {(mode) => {
          const sans = getComputedStyle(document.documentElement).getPropertyValue('--font-sans').trim();
          const mono = getComputedStyle(document.documentElement).getPropertyValue('--font-mono').trim();
          const stacks = mode === 'current'
            ? { sans, mono }
            : { sans: "system-ui, 'Segoe UI Variable Text', 'Segoe UI', -apple-system, sans-serif", mono: "ui-monospace, 'Cascadia Mono', 'SF Mono', Consolas, monospace" };
          return (
            <div className="sp-stack-lg" data-font-mode={mode}>
              <div className="sp-stack">
                <div className="typo-label text-foreground">Sans stack</div>
                <code className="typo-code text-foreground">{stacks.sans}</code>
                <div className="typo-body-lg text-foreground">{SAMPLE.sentence}</div>
              </div>
              <div className="sp-stack">
                <div className="typo-label text-foreground">Mono stack</div>
                <code className="typo-code text-foreground">{stacks.mono}</code>
                <div className="typo-code text-foreground" style={{ fontSize: '1.125rem' }}>{SAMPLE.code} 0O1lI {SAMPLE.metric}</div>
              </div>
              <div className="sp-stack">
                <div className="typo-label text-foreground">Faces present on this machine</div>
                {FACES.map((f) => (
                  <div key={f} className="typo-body text-foreground" data-face={f} data-present={found[f] ? 'yes' : 'no'}>
                    <span className={found[f] ? 'text-status-success' : 'text-status-error'}>{found[f] ? 'present' : 'absent'}</span> {f}
                  </div>
                ))}
              </div>
              {mode === 'proposed' && (
                <div className="typo-caption">
                  Name what ships. Inter and JetBrains Mono are first in today's stacks but never loaded (no @font-face,
                  no bundled file), so a machine without them renders the system face (Segoe UI on Windows) and whatever
                  the engine's generic monospace is (Consolas: Chromium's Windows default, confirmed for this page through
                  the DevTools protocol, CSS.getPlatformFontsForNode). The Events and Manifest surfaces were judged in Segoe UI. Bundling Inter is the alternative: a new asset
                  dependency (an estimated 100 to 350 KB of woff2, by subsetting). That is a Gate 0 decision, not a default.
                </div>
              )}
            </div>
          );
        }}
      </Split>
    </Section>
  );
}
