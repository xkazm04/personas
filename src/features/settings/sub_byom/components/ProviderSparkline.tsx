import { useMemo } from 'react';
import { useTranslation } from '@/i18n/useTranslation';

interface ProviderSparklineProps {
  data: number[];
  width?: number;
  height?: number;
  color?: string;
  label?: string;
}

/**
 * Lightweight inline SVG sparkline — no charting library needed.
 * Renders a smooth polyline with an area fill gradient beneath.
 */
export function ProviderSparkline({
  data,
  width = 120,
  height = 28,
  color = '#10b981',
  label,
}: ProviderSparklineProps) {
  const { t } = useTranslation();
  const path = useMemo(() => {
    if (data.length < 2) return '';
    const max = Math.max(...data, 1);
    const min = Math.min(...data, 0);
    const range = max - min || 1;
    const padY = 2;
    const usableH = height - padY * 2;

    const points = data.map((v, i) => {
      const x = (i / (data.length - 1)) * width;
      const y = padY + usableH - ((v - min) / range) * usableH;
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    });

    return `M${points.join(' L')}`;
  }, [data, width, height]);

  const areaPath = useMemo(() => {
    if (!path) return '';
    return `${path} L${width},${height} L0,${height} Z`;
  }, [path, width, height]);

  const gradientId = useMemo(
    () => `spark-${color.replace('#', '')}-${Math.random().toString(36).slice(2, 6)}`,
    [color],
  );

  if (data.length < 2) {
    return (
      <span className="text-[10px] text-foreground italic">
        {t.settings.byom.no_trend_data}
      </span>
    );
  }

  return (
    <div className="inline-flex flex-col items-start gap-0.5">
      {label && (
        <span className="text-[10px] text-foreground leading-none">{label}</span>
      )}
      <svg
        width={width}
        height={height}
        viewBox={`0 0 ${width} ${height}`}
        className="overflow-visible"
      >
        <defs>
          <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={color} stopOpacity={0.25} />
            <stop offset="100%" stopColor={color} stopOpacity={0.02} />
          </linearGradient>
        </defs>
        <path d={areaPath} fill={`url(#${gradientId})`} />
        <path d={path} fill="none" stroke={color} strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    </div>
  );
}
