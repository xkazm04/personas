// The Gate 0 specimen: the app's current visual vocabulary beside the
// proposed one. A harness page, served by the app's own Vite, loading the
// app's real stylesheet and the real theme store, so every token resolves
// exactly as it does in the app. Nothing in this folder is imported by the app.
//
// URL: /docs/design/style-mastery/specimen/index.html
//   ?theme=<id>       one of the eleven themes (default dark-midnight)
//   &scale=<id>       large | larger | xl  (Small / Standard / Large)
//   &view=<id>        side | current | proposed
//   &section=<id>     type | muting | colour | compose | font  (default: all)
import { useEffect, useState } from 'react';
import ReactDOM from 'react-dom/client';
import { useThemeStore } from '@/stores/themeStore';
import type { ThemeId } from '@/stores/themeStore';
import '@/styles/globals.css';
import '@/styles/typography.proposed.css';
import '@/styles/accent-roles.proposed.css';
import './specimen.css';
import type { View } from './parts';
import { TEXT_SCALES, THEMES, type TextScaleId, type ThemeName } from './specimenData';
import { TypeScale } from './sections/TypeScale';
import { Muting } from './sections/Muting';
import { ColourRoles } from './sections/ColourRoles';
import { Compositions } from './sections/Compositions';
import { FontSection } from './sections/FontSection';

const SECTIONS = ['type', 'muting', 'colour', 'compose', 'font'] as const;

function readParams() {
  const p = new URLSearchParams(window.location.search);
  const theme = (THEMES as readonly string[]).includes(p.get('theme') ?? '') ? (p.get('theme') as ThemeName) : 'dark-midnight';
  const scale = TEXT_SCALES.some((s) => s.id === p.get('scale')) ? (p.get('scale') as TextScaleId) : 'larger';
  const view = (['side', 'current', 'proposed'] as const).find((v) => v === p.get('view')) ?? 'side';
  const section = (SECTIONS as readonly string[]).includes(p.get('section') ?? '') ? p.get('section') : null;
  return { theme, scale, view: view as View, section };
}

function Specimen() {
  const [state, setState] = useState(readParams);
  const { theme, scale, view, section } = state;

  useEffect(() => {
    useThemeStore.getState().setTheme(theme as ThemeId);
    useThemeStore.getState().setTextScale(scale);
    const p = new URLSearchParams({ theme, scale, view, ...(section ? { section } : {}) });
    window.history.replaceState(null, '', `?${p.toString()}`);
    document.documentElement.dataset.specimenReady = `${theme}|${scale}|${view}`;
  }, [theme, scale, view, section]);

  const env = `${theme}|${scale}`;
  const show = (id: string) => !section || section === id;
  return (
    <div className="sp-page">
      <div className="sp-bar">
        <span className="typo-heading text-foreground">Gate 0 specimen</span>
        <label className="typo-caption">Theme
          <select value={theme} onChange={(e) => setState({ ...state, theme: e.target.value as ThemeName })} data-control="theme">
            {THEMES.map((t) => <option key={t} value={t}>{t}</option>)}
          </select>
        </label>
        <label className="typo-caption">Text scale
          <select value={scale} onChange={(e) => setState({ ...state, scale: e.target.value as TextScaleId })} data-control="scale">
            {TEXT_SCALES.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
          </select>
        </label>
        <label className="typo-caption">View
          <select value={view} onChange={(e) => setState({ ...state, view: e.target.value as View })} data-control="view">
            <option value="side">Current beside proposed</option>
            <option value="current">Current only</option>
            <option value="proposed">Proposed only</option>
          </select>
        </label>
        <nav className="typo-caption">
          {SECTIONS.map((s) => <a key={s} href={`#${s}`}>{s}</a>)}
        </nav>
      </div>
      {show('type') && <TypeScale view={view} env={env} />}
      {show('muting') && <Muting view={view} theme={theme} />}
      {show('colour') && <ColourRoles view={view} theme={theme} />}
      {show('compose') && <Compositions view={view} />}
      {show('font') && <FontSection view={view} />}
    </div>
  );
}

const root = document.getElementById('root');
if (root) ReactDOM.createRoot(root).render(<Specimen />);
