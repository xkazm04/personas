// Entry point for a 3D Mastermind prototype: the WebGL canvas, the variant's
// world, and the shared HUD — lazy-loaded by the page so the baseline canvas
// never pays for three.js. The variant's palette is mirrored onto the root as
// --w-* custom properties so the DOM overlay and the shaders agree on colour.
import { Canvas } from '@react-three/fiber';
import { Component, Suspense, type ErrorInfo, type ReactNode } from 'react';

import { useTranslation } from '@/i18n/useTranslation';
import { silentCatch } from '@/lib/silentCatch';

import { HoloWorld } from './HoloWorld';
import { MOCK_WORLD } from './mockWorld';
import { PALETTES, paletteVars, type WorldVariant } from './palettes';
import { StrataWorld } from './StrataWorld';
import { useWorldNav } from './useWorldNav';
import { WorldHud } from './WorldHud';
import './world.css';

/** A WebGL failure must not take the whole Mastermind page down — the tab
 *  switcher stays reachable so the user can go back to the baseline. */
class WorldBoundary extends Component<{ fallback: ReactNode; children: ReactNode }, { failed: string | null }> {
  state: { failed: string | null } = { failed: null };
  static getDerivedStateFromError(err: unknown) { return { failed: err instanceof Error ? err.message : String(err) }; }
  componentDidCatch(err: Error, info: ErrorInfo) { silentCatch('mastermind 3d world')(Object.assign(err, { componentStack: info.componentStack })); }
  render() {
    // The failure reason rides on a data attribute so a test probe (or a
    // developer's inspector) can read it without a console.
    return this.state.failed !== null ? <div data-testid="mm3d-failed" data-error={this.state.failed}>{this.props.fallback}</div> : this.props.children;
  }
}

const WORLDS = { strata: StrataWorld, holo: HoloWorld } as const;

export default function WorldCanvas({ variant }: { variant: WorldVariant }) {
  const { t } = useTranslation();
  const palette = PALETTES[variant];
  const nav = useWorldNav(MOCK_WORLD);
  const World = WORLDS[variant];
  return (
    <div className="mm3d" style={paletteVars(palette) as React.CSSProperties} data-variant={variant} data-testid={`mm3d-${variant}`}>
      <WorldBoundary fallback={<p className="mm3d-fallback">{t.mastermind.world_unsupported}</p>}>
        <Canvas
          dpr={[1, 1.75]}
          camera={{ fov: 42, near: 0.1, far: 400, position: [0, 12, 24] }}
          // preserveDrawingBuffer lets the page read its own frame back with
          // canvas.toDataURL(), which is how these prototypes are screenshotted:
          // the app runs on the operator's second virtual desktop, where no
          // OS-level window grab can see it. Costs one extra buffer; the
          // prototypes are not the place to optimise that away.
          gl={{ antialias: true, alpha: false, powerPreference: 'high-performance', preserveDrawingBuffer: true }}
          // A click on the empty sea walks one layer up — but ONLY a click that
          // actually landed on the canvas. R3F's listener sits on the canvas's
          // parent, so a click on a DOM label (drei <Html>, a sibling of the
          // canvas) bubbles into it too, with a ray that hits nothing: without
          // this guard every label click was immediately undone by an up().
          onPointerMissed={(e) => { if (e.target instanceof HTMLCanvasElement) nav.up(); }}
        >
          <Suspense fallback={null}>
            <World world={MOCK_WORLD} nav={nav} />
          </Suspense>
        </Canvas>
      </WorldBoundary>
      <div className={variant === 'holo' ? 'mm3d-film mm3d-film--scan' : 'mm3d-film'} aria-hidden />
      <WorldHud world={MOCK_WORLD} nav={nav} palette={palette} variant={variant} />
    </div>
  );
}
