/**
 * The Port map's scale: band bars, torn breaks between bands, one tick per
 * port (lit in the pin's tone, hollow and dashed for an external listener),
 * free holes inside a short run, and the port figures, sized to the room a
 * unit of axis actually has at this width.
 */
import type { CSSProperties } from 'react';

import { Tooltip } from '@/features/shared/components/display/Tooltip';
import { useTranslation } from '@/i18n/useTranslation';

import type { PortAxis } from './portAxis';
import type { PinLook } from './pinLook';

const col = (start: number, end: number): CSSProperties => ({ gridColumn: `${start + 1} / ${end + 1}` });

/**
 * Port figure size by the room one port unit gets, in type steps: four bold
 * tabular digits are ~2.3em wide, plus breathing room, so neighbours never touch.
 */
function portType(unitEm: number): string {
  if (unitEm >= 4.8) return 'typo-data-lg';
  if (unitEm >= 4.25) return 'typo-heading-lg tabular-nums';
  if (unitEm >= 3.3) return 'typo-title-lg tabular-nums';
  return 'typo-data';
}

interface PortScaleProps {
  axis: PortAxis;
  looks: readonly PinLook[];
  hostPort: number | null;
  /** One port unit of axis, measured in `--type-1` steps. */
  unitEm: number;
}

export default function PortScale({ axis, looks, hostPort, unitEm }: PortScaleProps) {
  const { t, tx } = useTranslation();
  const p = t.browser.servers.portmap;
  const size = portType(unitEm);

  return (
    <div className="pm-axis" style={{ gridTemplateColumns: `repeat(${axis.cols}, minmax(0, 1fr))` }}>
      {axis.bands.map((band) => (
        <div key={`band-${band.from}`} className="pm-band" style={col(band.start + 2, band.end - 2)} aria-hidden />
      ))}
      {axis.breaks.map((gap) => (
        <Tooltip key={`gap-${gap.from}`} content={tx(p.skipped, { from: gap.from, to: gap.to })}>
          <div className="pm-break" style={col(gap.start, gap.end)} />
        </Tooltip>
      ))}
      {axis.pins.map((pin, i) => {
        const look = looks[i]!;
        return (
          <div key={pin.port} className="contents">
            <div
              className={`pm-tick is-pin ${look.tone} ${look.state} ${look.scan ? 'is-scan' : ''}`}
              style={col(pin.center - 1, pin.center + 1)}
              aria-hidden
            />
            <div className="pm-label" style={col(pin.center - 5, pin.center + 5)}>
              <span className={`${size} ${look.tone} ${look.state === 'is-lit' ? 'pm-tone-ink' : 'text-foreground'}`}>
                {pin.port}
              </span>
              {pin.port === hostPort && <span className="typo-eyebrow text-primary">{p.host_tick}</span>}
            </div>
          </div>
        );
      })}
      {axis.holes.map((hole) => (
        <div key={`hole-${hole.port}`} className="contents">
          <div className="pm-tick" style={col(hole.center - 1, hole.center + 1)} aria-hidden />
          <Tooltip content={tx(p.free_port, { port: hole.port })}>
            <div className="pm-label" style={col(hole.center - 5, hole.center + 5)}>
              <span className="typo-caption text-foreground">{hole.port}</span>
            </div>
          </Tooltip>
        </div>
      ))}
    </div>
  );
}
