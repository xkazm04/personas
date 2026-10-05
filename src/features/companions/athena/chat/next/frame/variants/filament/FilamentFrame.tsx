/**
 * Filament · the frame layer itself.
 *
 * `VariantFrame` lays its pieces out in an inset three-column grid, which is
 * the right shape for Halo (floating cards) and the WRONG one for this look:
 * Filament's whole idea is ONE lit line that hugs the window's bezel — across
 * the top, round the corner, down the right — with each piece sitting ON that
 * line as a segment of it. A piece centred in a 736px column in the middle of
 * the page is not on any bezel. So this variant owns its own layer instead of
 * filling `VariantFrame`'s slots, and the geometry below is the contest mock's
 * own, expressed as fractions of the layer rather than of its fixed 1600x960
 * stage (`.contest/arena/athena-chrome/entries/…/variant-1/index.html`).
 *
 * What still differs from the mock, deliberately, and why:
 * - The composer (`FrameBottom`) stays on screen at the bottom. The mock had
 *   no composer at all — it lived inside the top spread — but this is the real
 *   app and typing to her is the main verb.
 * - `AthenaToolbar` keeps its own internal button styling (Halo's icon rail).
 *   It sits on the lower right run now, where the mock puts the tools segment,
 *   but its buttons are not yet the mock's `.tnode` marks.
 *
 * TODO(prototype, 2026-10-03): consolidate the Athena chat switcher.
 */

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { BrainViewer } from '../../../../../BrainViewer';
import { AthenaToolbar } from '../../../../../AthenaToolbar';
import { useAthenaStore } from '../../../../../athenaStore';
import type { AthenaChatEngine } from '../../../../athenaChatEngine';
import { NEXT_COPY as C } from '../../../nextCopy';
import { useLayer } from '../../../useLayer';
import { useLayerRefOpener } from '../../../useLayerRefOpener';
import { ReportReader } from '../../../../refs/ReportReader';
import { RefOpenerProvider } from '../../../../refs/RefOpenerContext';
import { useProcessColumns } from '../../../useProcessColumns';
import { useWorkforce } from '../../../useWorkforce';
import { FrameBottom } from '../../FrameBottom';
import { FRAME_LOOKS } from '../../frameLook';
import { FilamentPanel } from './FilamentPanel';
import { FilamentStage } from './FilamentStage';
import { FilamentTopView } from './FilamentTopView';
import './filament.css';

/**
 * Where the top run sits: on the APP header's bottom edge — the title bar's,
 * not the route's own content header. Measured, because the layer's `top` is a
 * stale constant and the title bar's height is not the `--titlebar-height`
 * token (which resolves to its 40px fallback while `.titlebar` renders 48).
 *
 * The result is normally NEGATIVE — the line belongs above the layer's own box
 * — which is fine for an absolutely positioned child and keeps the rest of the
 * geometry hanging off one variable.
 */
function useHeaderSeam(layerRef: React.RefObject<HTMLDivElement | null>) {
  const [seam, setSeam] = useState<{ line: number; content: number } | null>(null);
  const measure = () => {
    const layer = layerRef.current;
    if (!layer) return;
    const layerTop = layer.getBoundingClientRect().top;
    const bar = document.querySelector('.titlebar');
    const line = bar ? bar.getBoundingClientRect().bottom - layerTop : 14;
    // The route's own header band sits UNDER the title bar and owns that
    // space (its title, its tabs). The line runs along the app seam, but the
    // segments hang below the route header so they never cover its words —
    // a short stem keeps them visibly attached to the circuit.
    let content = line;
    for (const el of document.querySelectorAll<HTMLElement>('div,header,nav')) {
      const r = el.getBoundingClientRect();
      if (r.width < window.innerWidth * 0.55 || r.top < 8 || r.bottom > layerTop + 120 || r.bottom <= r.top) continue;
      if (parseFloat(getComputedStyle(el).borderBottomWidth) < 0.5) continue;
      const rel = r.bottom - layerTop;
      if (rel > content) content = rel;
    }
    setSeam({ line: Math.round(line), content: Math.round(content) });
  };
  const measureRef = useRef(measure);
  measureRef.current = measure;
  useLayoutEffect(measure);
  useEffect(() => {
    const onResize = () => measureRef.current();
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);
  return seam;
}

/**
 * The circuit: a border-drawn line (top run, rounded corner, right run) rather
 * than the mock's SVG path, because this layer resizes with the window and a
 * non-uniformly scaled SVG stroke would thin out on one axis.
 */
function Circuit({ working, urgent }: { working: boolean; urgent: boolean }) {
  return (
    <div className="fil-circuit" aria-hidden>
      <div className="fil-wire" />
      <div className={`fil-wire-live${urgent ? ' urgent' : ''}`} />
      {/* The stem: drops from the line to the segment that hangs below the
          route header, so the piece still reads as part of the circuit. */}
      <div className="fil-stem" />
      {working && <div className="fil-pulse" />}
    </div>
  );
}

export function FilamentFrame({ engine, lifted }: { engine: AthenaChatEngine; lifted: boolean }) {
  const look = FRAME_LOOKS.filament;
  const workforce = useWorkforce();
  const columns = useProcessColumns(workforce, C.athena);
  const layer = useLayer();
  const { view } = layer;
  const refOpener = useLayerRefOpener(layer, workforce.items);
  const [expanded, setExpanded] = useState(false);
  const streaming = useAthenaStore((s) => s.streaming);
  const brainOpen = useAthenaStore((s) => s.brainView.open);
  const layerRef = useRef<HTMLDivElement>(null);
  const seam = useHeaderSeam(layerRef);

  const decisionsOpen = view.kind === 'work' && !brainOpen;
  const focusId = view.kind === 'work' ? (view.focus ?? workforce.items[0]?.id ?? null) : null;
  const about = useMemo(
    () => (view.kind === 'work' ? (workforce.items.find((i) => i.id === focusId) ?? null) : null),
    [view.kind, workforce.items, focusId],
  );
  const centreOpen = brainOpen || view.kind === 'report';
  const expandedTop = expanded && !centreOpen && !decisionsOpen;
  const toggleExpanded = () => {
    if (expandedTop) {
      setExpanded(false);
      return;
    }
    if (view.kind !== 'chat') layer.back();
    if (brainOpen) useAthenaStore.getState().setBrainView({ open: false, kind: null, id: null });
    setExpanded(true);
  };

  const urgent = workforce.counts.waiting > 0;

  return (
    <RefOpenerProvider value={refOpener}>
      <div
        ref={layerRef}
        // Above the route's own header band (which otherwise paints over the
        // segments and swallows their clicks), below the title bar and modals.
        className={`filament-frame fixed inset-x-0 bottom-0 top-[112px] ${lifted ? 'z-[220]' : 'z-[120]'} pointer-events-none${streaming ? ' working' : ''}`}
        data-testid="companion-panel"
        style={
          seam === null
            ? undefined
            : ({ ['--fil-seam']: `${seam.line}px`, ['--fil-content']: `${seam.content}px` } as React.CSSProperties)
        }
      >
        <Circuit working={streaming} urgent={urgent} />

        {/* TOP run: her segment sits ON the line, not in a column. */}
        <div className={`fil-top-seat${expandedTop ? ' open' : ''}`}>
          <FilamentTopView
            look={look}
            engine={engine}
            expanded={expandedTop}
            onExpand={toggleExpanded}
            onOpenWaiting={() => layer.openWork()}
          />
        </div>

        {/* The RIGHT run: the waiting segment, then the tools segment under it. */}
        <div className="fil-right-run">
          <div className="fil-queue-seat">
            <FilamentPanel
              columns={columns}
              waiting={workforce.counts.waiting}
              onOpenItem={(id) => layer.openWork(id, null)}
              onOpenWaiting={layer.toggleWork}
            />
          </div>
          <div className="fil-tools-seat">
            <AthenaToolbar dock="single" className="bg-transparent" />
          </div>
        </div>

        {/* The centre: Brain / a report / the decision surface. */}
        <div className="fil-centre">
          {centreOpen && (
            <div className="spread fil-centre-panel">
              <span className="lit-edge" aria-hidden />
              {brainOpen ? (
                <BrainViewer onClose={() => useAthenaStore.getState().setBrainView({ open: false, kind: null, id: null })} />
              ) : view.kind === 'report' ? (
                <ReportReader reportId={view.id} onClose={layer.back} overlay={false} escToClose={false} />
              ) : null}
            </div>
          )}
          <FilamentStage
            items={workforce.items}
            open={decisionsOpen}
            focusId={focusId}
            onFocus={(id) => layer.openWork(id, null)}
            onClose={layer.back}
            onSend={engine.send}
          />
        </div>

        {/* The composer keeps the bottom; the mock had none. */}
        <div className="fil-composer">
          <FrameBottom engine={engine} about={about} onClearAbout={layer.back} />
        </div>
      </div>
    </RefOpenerProvider>
  );
}
