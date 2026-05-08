import { useMemo } from 'react';
import { useTranslation } from '@/i18n/useTranslation';
import { GLYPH_DIMENSIONS } from './types';
import type { GlyphRow, GlyphDimension } from './types';
import { DIM_META, PETAL_ANGLES } from './dimMeta';
import { SigilPetal } from './SigilPetal';

interface InteractiveSigilProps {
  row: GlyphRow;
  rowIndex: number;
  hoveredDim: GlyphDimension | null;
  activeDim: GlyphDimension | null;
  onHover: (dim: GlyphDimension | null) => void;
  onClick: (dim: GlyphDimension) => void;
  size: number;
}

const PETAL_OUTER_RATIO = 0.44;
const PETAL_INNER_RATIO = 0.14;
const CORE_RATIO = 0.12;
const ICON_R_LINKED_RATIO = 0.28;
const ICON_R_SHARED_RATIO = 0.24;
const ICON_R_EMPTY_RATIO = 0.28;
const GUIDE_INNER_RATIO = 0.305;

interface PetalIconLayout {
  dim: GlyphDimension;
  xLinked: number; yLinked: number;
  xShared: number; yShared: number;
  xEmpty: number; yEmpty: number;
  iconBoxLinked: number;
  iconBoxOther: number;
}

interface SigilGeometry {
  center: number;
  petalOuter: number;
  petalInner: number;
  coreR: number;
  guideInner: number;
  petalPath: string;
  petalPathDashed: string;
  iconLayouts: PetalIconLayout[];
}

const geometryCache = new Map<number, SigilGeometry>();

function getGeometry(size: number): SigilGeometry {
  const cached = geometryCache.get(size);
  if (cached) return cached;

  const center = size / 2;
  const petalOuter = size * PETAL_OUTER_RATIO;
  const petalInner = size * PETAL_INNER_RATIO;
  const coreR = size * CORE_RATIO;
  const guideInner = size * GUIDE_INNER_RATIO;
  const iconRLinked = size * ICON_R_LINKED_RATIO;
  const iconRShared = size * ICON_R_SHARED_RATIO;
  const iconREmpty = size * ICON_R_EMPTY_RATIO;
  const iconBoxLinked = size * 0.094;
  const iconBoxOther = size * 0.065;

  const petalPath =
    `M 0 -${petalInner} C ${size * 0.06} -${petalOuter * 0.49}, ${size * 0.06} -${petalOuter * 0.77}, 0 -${petalOuter} ` +
    `C -${size * 0.06} -${petalOuter * 0.77}, -${size * 0.06} -${petalOuter * 0.49}, 0 -${petalInner} Z`;
  const petalPathDashed =
    `M 0 -${petalInner} C ${size * 0.05} -${petalOuter * 0.46}, ${size * 0.05} -${petalOuter * 0.71}, 0 -${petalOuter - 10} ` +
    `C -${size * 0.05} -${petalOuter * 0.71}, -${size * 0.05} -${petalOuter * 0.46}, 0 -${petalInner} Z`;

  const iconLayouts: PetalIconLayout[] = GLYPH_DIMENSIONS.map((dim) => {
    const angle = PETAL_ANGLES[dim];
    const rad = (angle - 90) * Math.PI / 180;
    const cos = Math.cos(rad);
    const sin = Math.sin(rad);
    return {
      dim,
      xLinked: center + iconRLinked * cos,
      yLinked: center + iconRLinked * sin,
      xShared: center + iconRShared * cos,
      yShared: center + iconRShared * sin,
      xEmpty: center + iconREmpty * cos,
      yEmpty: center + iconREmpty * sin,
      iconBoxLinked,
      iconBoxOther,
    };
  });

  const geometry: SigilGeometry = {
    center, petalOuter, petalInner, coreR, guideInner,
    petalPath, petalPathDashed, iconLayouts,
  };
  geometryCache.set(size, geometry);
  return geometry;
}

/** The card's hero illustration — eight petal slots rendered to a single SVG.
 *  Guide rings and the core stay static; only petal state + icon overlay
 *  react to hover/active. HTML icons ride on top so tooltips + theme-aware
 *  colouring don't have to reimplement SVG text handling.
 *
 *  Geometry (paths, ring radii, icon positions) is keyed only on `size` and
 *  cached at module scope, so hover-driven re-renders don't rebuild path
 *  strings or recompute petal trig — see idea-5d95dae2 for the perf rationale. */
export function InteractiveSigil({
  row, rowIndex, hoveredDim, activeDim, onHover, onClick, size,
}: InteractiveSigilProps) {
  const { t } = useTranslation();
  const c = t.templates.chronology;
  const linkedCount = useMemo(
    () => Object.values(row.presence).filter((p) => p === 'linked').length,
    [row.presence],
  );

  const geom = getGeometry(size);
  const { center, petalOuter, coreR, guideInner, petalPath, petalPathDashed, iconLayouts } = geom;

  const coreId = `sigil-core-${row.id}-${rowIndex}`;
  const glowId = `sigil-glow-${row.id}-${rowIndex}`;

  return (
    <div className="relative" style={{ width: size, height: size }}>
      <svg
        width={size}
        height={size}
        viewBox={`0 0 ${size} ${size}`}
        className="absolute inset-0"
        style={{ opacity: row.enabled ? 1 : 0.5 }}
      >
        <defs>
          <radialGradient id={coreId} cx="50%" cy="50%" r="50%">
            <stop offset="0%" stopColor="#fff" stopOpacity="0.6" />
            <stop offset="55%" stopColor="#60a5fa" stopOpacity="0.35" />
            <stop offset="100%" stopColor="#60a5fa" stopOpacity="0.02" />
          </radialGradient>
          <filter id={glowId} x="-50%" y="-50%" width="200%" height="200%">
            <feGaussianBlur stdDeviation="3" result="blur" />
            <feMerge>
              <feMergeNode in="blur" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
        </defs>

        <circle cx={center} cy={center} r={petalOuter} fill="none" stroke="currentColor" strokeOpacity="0.08" strokeWidth="1" />
        <circle cx={center} cy={center} r={guideInner} fill="none" stroke="currentColor" strokeOpacity="0.05" strokeWidth="1" strokeDasharray="2,4" />

        {GLYPH_DIMENSIONS.map((dim, i) => (
          <SigilPetal
            key={`petal-${dim}`}
            dim={dim}
            presence={row.presence[dim]}
            index={i}
            size={size}
            rowId={row.id}
            rowIndex={rowIndex}
            glowId={glowId}
            petalPath={petalPath}
            petalPathDashed={petalPathDashed}
            isHovered={hoveredDim === dim}
            isActive={activeDim === dim}
            dimOther={activeDim !== null && activeDim !== dim}
            onHover={onHover}
            onClick={onClick}
          />
        ))}

        <circle cx={center} cy={center} r={coreR + 10} fill="none" stroke="currentColor" strokeOpacity="0.12" strokeWidth="1" />
        <circle cx={center} cy={center} r={coreR} fill={`url(#${coreId})`} />
        <circle cx={center} cy={center} r={coreR} fill="none" stroke="currentColor" strokeOpacity={row.enabled ? 0.45 : 0.18} strokeWidth="1.2" />
        <text x={center} y={center + 2} textAnchor="middle" dominantBaseline="middle" className="fill-current"
          style={{ fontSize: `${size * 0.09}px`, fontWeight: 700, letterSpacing: '0.03em' }}>
          {linkedCount}
        </text>
        <text x={center} y={center + size * 0.065} textAnchor="middle" dominantBaseline="middle" className="fill-current"
          style={{ fontSize: `${size * 0.027}px`, letterSpacing: '0.3em', opacity: 0.55 }}>
          DIMS
        </text>
      </svg>

      {/* HTML icon overlay */}
      {iconLayouts.map(({ dim, xLinked, yLinked, xShared, yShared, xEmpty, yEmpty, iconBoxLinked, iconBoxOther }) => {
        const presence = row.presence[dim];
        const meta = DIM_META[dim];
        const Icon = meta.icon;
        const isHovered = hoveredDim === dim;
        const isActive = activeDim === dim;
        const dimOther = activeDim !== null && !isActive;

        const iconBox = presence === 'linked' ? iconBoxLinked : iconBoxOther;
        const x = presence === 'linked' ? xLinked : presence === 'shared' ? xShared : xEmpty;
        const y = presence === 'linked' ? yLinked : presence === 'shared' ? yShared : yEmpty;
        const label = c[meta.labelKey];

        return (
          <div
            key={`icon-${dim}`}
            className="absolute flex items-center justify-center pointer-events-none transition-opacity"
            style={{
              left: x - iconBox / 2, top: y - iconBox / 2,
              width: iconBox, height: iconBox,
              opacity: dimOther ? 0.2 : 1,
            }}
            title={c.presence_tooltip.replace('{label}', label).replace('{state}', presence)}
          >
            {presence === 'linked' ? (
              <>
                <span className="absolute inset-0 rounded-full transition-all duration-200" style={{
                  background: `${meta.color}${isHovered ? '55' : '33'}`,
                  boxShadow: `0 0 ${isHovered ? '20px' : '14px'} ${meta.color}${isHovered ? 'aa' : '77'}`,
                }} />
                <Icon className="relative" style={{
                  width: iconBox - 10, height: iconBox - 10,
                  color: '#fff', filter: `drop-shadow(0 0 4px ${meta.color})`,
                }} />
              </>
            ) : presence === 'shared' ? (
              <Icon className={meta.colorClass} style={{ width: iconBox - 4, height: iconBox - 4, opacity: isHovered ? 1 : 0.8 }} />
            ) : (
              <Icon style={{
                width: iconBox - 6, height: iconBox - 6,
                color: isHovered ? meta.color : 'currentColor',
                opacity: isHovered ? 0.7 : 0.3,
              }} />
            )}
          </div>
        );
      })}
    </div>
  );
}
