// Console law specimen: recipes, ink ladder, hair/surface roles, density axis.
// Harness page; nothing in the app imports it. ?theme=<id>
import { useEffect, type CSSProperties, type ReactNode } from 'react';
import ReactDOM from 'react-dom/client';
import '@fontsource-variable/inter/opsz.css';
import '@fontsource-variable/jetbrains-mono/wght.css';
import '@/styles/globals.css';
import { useThemeStore } from '@/stores/themeStore';
import type { ThemeId } from '@/stores/themeStore';

const RECIPES: [string, string][] = [
  ['typo-hero', 'Good morning, 128'],
  ['typo-heading-lg', 'Page title, 18 semibold'],
  ['typo-submodule-header', 'Submodule header'],
  ['typo-section-title', 'Section title'],
  ['typo-heading', 'Heading 15'],
  ['typo-title-lg', 'Title large'],
  ['typo-title', 'Title, ink not primary'],
  ['typo-card-label', 'Card label, no glow'],
  ['typo-body-lg', 'Body large reads at 15 with 1,204 runs and 0.91 ratio'],
  ['typo-body', 'Body reads at 14 with 1,204 runs and 0.91 ratio, ID a0f3-00'],
  ['typo-caption', 'Caption 13, ink-2: updated 14:02, 38 items'],
  ['typo-label', 'Label 13 medium'],
  ['typo-eyebrow', 'Eyebrow: the label tier'],
  ['typo-data', '12,408.55  0O0  ab-cd'],
  ['typo-data-lg', '1,204.7'],
  ['typo-code', 'const run = start(persona.id)'],
];
const INKS = ['ink-1', 'ink-2', 'ink-3', 'ink-4'];
const BOX: CSSProperties = { border: '1px solid var(--hair)', background: 'var(--surface-1)', padding: 'var(--gutter-page)' };
const CELL: CSSProperties = { display: 'flex', alignItems: 'center', padding: '0 0.75rem' };

function Block({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section style={{ marginBottom: '1.5rem' }}>
      <div className="typo-eyebrow" style={{ marginBottom: '0.5rem' }}>{title}</div>
      <div style={BOX}>{children}</div>
    </section>
  );
}

function Density({ value }: { value?: string }) {
  return (
    <div data-density={value} style={{ flex: 1 }}>
      <div className="typo-eyebrow">{value ?? 'default (Console)'}</div>
      {['Row one', 'Row two', 'Row three'].map((r, i) => (
        <div key={r} style={{ height: 'var(--row-h)', display: 'flex', alignItems: 'center', gap: '0.75rem', borderBottom: '1px solid var(--hair)', paddingInline: 'var(--gutter-page)' }}>
          <span className="typo-body">{r}</span><span className="typo-data" style={{ marginLeft: 'auto' }}>{(i + 1) * 128}</span>
        </div>
      ))}
      <div style={{ display: 'flex', gap: '0.5rem', marginTop: '0.75rem' }}>
        <div className="typo-label" style={{ ...CELL, height: 'var(--control-h)', border: '1px solid var(--hair-2)', borderRadius: 'var(--radius-interactive)' }}>Control</div>
        <div className="typo-label" style={{ ...CELL, height: 'var(--control-h-lg)', background: 'var(--primary)', color: 'var(--background)', borderRadius: 'var(--radius-interactive)' }}>Control lg</div>
        <div className="typo-caption" style={{ ...CELL, height: 'var(--head-h)', border: '1px solid var(--hair)' }}>head</div>
        <div className="typo-caption" style={{ ...CELL, height: 'var(--group-h)', border: '1px solid var(--hair)' }}>group</div>
      </div>
    </div>
  );
}

function Specimen() {
  const p = new URLSearchParams(window.location.search);
  const theme = (p.get('theme') ?? 'dark-midnight') as ThemeId;
  useEffect(() => {
    useThemeStore.getState().setTheme(theme);
    document.documentElement.dataset.specimenReady = theme;
  }, [theme]);
  return (
    <div style={{ padding: '1.5rem', background: 'var(--background)', color: 'var(--foreground)', minHeight: '100vh' }}>
      <div className="typo-heading-lg" style={{ marginBottom: '1rem' }}>Console specimen <span className="typo-eyebrow">{theme}</span></div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1.5rem' }}>
        <div>
          <Block title="Recipes">
            {RECIPES.map(([c, text]) => (
              <div key={c} style={{ display: 'flex', alignItems: 'baseline', gap: '1rem', padding: '0.25rem 0', borderBottom: '1px solid var(--grid)' }}>
                <span className="typo-code" style={{ width: '11rem', color: 'var(--ink-3)', flex: 'none' }}>{c}</span>
                <span className={c}>{text}</span>
              </div>
            ))}
            <div style={{ marginTop: '0.5rem' }} className="typo-body">Inline figure: <span className="num">1,204.7 / 0.91 / 14:02</span> and plain 1,204.7</div>
          </Block>
        </div>
        <div>
          <Block title="Ink ladder">
            {INKS.map((k) => (
              <div key={k} style={{ display: 'flex', gap: '1rem', alignItems: 'baseline' }}>
                <span className="typo-code" style={{ width: '4rem' }}>{k}</span>
                <span style={{ color: `var(--${k})`, fontWeight: 500 }}>The quick brown fox jumps over 128 lazy dogs{k === 'ink-4' ? ' (never text)' : ''}</span>
              </div>
            ))}
          </Block>
          <Block title="Hairlines and surfaces">
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '0.75rem' }}>
              {['hair', 'hair-2', 'grid'].map((k) => (
                <div key={k} className="typo-code" style={{ border: `2px solid var(--${k})`, padding: '0.75rem' }}>{k}</div>
              ))}
              <div className="typo-code" style={{ background: 'var(--acc-wash)', padding: '0.75rem' }}>acc-wash</div>
              {['surface-1', 'surface-2', 'sel'].map((k) => (
                <div key={k} className="typo-code" style={{ background: `var(--${k})`, border: '1px solid var(--hair)', padding: '0.75rem' }}>{k}</div>
              ))}
            </div>
          </Block>
          <Block title="Density axis (type does not move)">
            <div style={{ display: 'flex', gap: '1.5rem' }}>
              <Density />
              <Density value="comfortable" />
            </div>
          </Block>
        </div>
      </div>
    </div>
  );
}

const root = document.getElementById('root');
if (root) ReactDOM.createRoot(root).render(<Specimen />);
