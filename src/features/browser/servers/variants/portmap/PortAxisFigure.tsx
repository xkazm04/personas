/**
 * The Port map figure. Pin cards hang in two alternating callout rows, evenly
 * spaced in port order, and a leader line ties each card to its tick on the
 * banded axis below (`portAxis.ts`, `PortScale`). Sorted cards to sorted ticks
 * never cross, and a far card's leader drops through the gap between two near
 * cards. External listeners are ghost pins: dashed card, dashed leader, hollow tick.
 */
import { useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type MouseEvent } from 'react';

import { useTranslation } from '@/i18n/useTranslation';
import type { DevServerView } from '@/lib/bindings/DevServerView';

import type { WorkspaceTag } from '../../serverModel';
import PinItem from './PinItem';
import PortScale from './PortScale';
import type { PortAxis } from './portAxis';
import { pinLook } from './pinLook';

interface FigureProps {
  axis: PortAxis;
  hostPort: number | null;
  now: number;
  workspaces: ReadonlyMap<string, WorkspaceTag>;
  onMenu: (e: MouseEvent, server: DevServerView) => void;
  onToggle: (server: DevServerView) => void;
}

/**
 * Width of the figure in TYPE units (the px of one `--type-1` step, which
 * follows the appearance setting), so the port figures size to the room the
 * axis really gives them at this width and this text scale.
 */
function useTypeWidth() {
  const ref = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(1200);
  const [typePx, setTypePx] = useState(14);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    // Measure the step instead of re-deriving it: the appearance setting scales it.
    const probe = document.createElement('span');
    probe.className = 'typo-data';
    el.appendChild(probe);
    setTypePx(parseFloat(getComputedStyle(probe).fontSize) || 14);
    probe.remove();
    const first = el.getBoundingClientRect().width;
    if (first > 0) setWidth(first);
    if (typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(([entry]) => {
      if (entry) setWidth(entry.contentRect.width);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return [ref, width / typePx] as const;
}

export default function PortAxisFigure({ axis, hostPort, now, workspaces, onMenu, onToggle }: FigureProps) {
  const { t } = useTranslation();
  const [ref, widthEm] = useTypeWidth();
  const looks = useMemo(() => axis.pins.map(pinLook), [axis]);
  const n = axis.pins.length;
  const slots = 2 * (n + 1);

  return (
    <div ref={ref} role="figure" aria-label={t.browser.servers.portmap.figure_label}>
      <div className="pm-cards" style={{ gridTemplateColumns: `repeat(${slots}, minmax(0, 1fr))` }}>
        {axis.pins.map((pin, i) => {
          const look = looks[i]!;
          const ws = look.lead.workspaceId ? workspaces.get(look.lead.workspaceId) : undefined;
          const frame = {
            gridColumn: `${2 * i + 1} / ${2 * i + 5}`,
            ...(ws ? { '--pm-ws': ws.color } : {}),
          } as CSSProperties;
          return (
            <div key={pin.port} className="contents">
              <div className={pin.row === 1 ? 'pm-row-far' : 'pm-row-near'} style={frame}>
                <div className={`pm-card ${look.tone} ${look.state} ${pin.port === hostPort ? 'is-host' : ''}`}>
                  {pin.servers.map((server) => (
                    <PinItem
                      key={server.projectId}
                      server={server}
                      hostPort={hostPort}
                      now={now}
                      workspace={server.workspaceId ? workspaces.get(server.workspaceId) : undefined}
                      onMenu={onMenu}
                      onToggle={onToggle}
                      align={i < n / 2 ? 'start' : 'end'}
                    />
                  ))}
                </div>
              </div>
              {pin.row === 1 && (
                <div className={`pm-stem ${look.tone} ${look.state}`} style={{ gridColumn: `${2 * i + 2} / ${2 * i + 4}` }} aria-hidden />
              )}
            </div>
          );
        })}
      </div>
      <svg className="pm-leaders" viewBox="0 0 1000 100" preserveAspectRatio="none" aria-hidden>
        {axis.pins.map((pin, i) => (
          <line
            key={pin.port}
            className={`pm-leader ${looks[i]!.tone} ${looks[i]!.state}`}
            x1={((i + 1) / (n + 1)) * 1000}
            y1={0}
            x2={(pin.center / axis.cols) * 1000}
            y2={100}
            vectorEffect="non-scaling-stroke"
          />
        ))}
      </svg>
      <PortScale axis={axis} looks={looks} hostPort={hostPort} unitEm={(widthEm * 10) / Math.max(1, axis.cols)} />
    </div>
  );
}
