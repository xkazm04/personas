import { useState } from 'react';
import { CONNECTION_TYPE_STYLES } from '../../libs/teamConstants';

const ENTRIES = Object.values(CONNECTION_TYPE_STYLES);

export default function ConnectionLegend() {
  const [hovered, setHovered] = useState(false);

  return (
    <div
      className="absolute bottom-3 right-3 z-[5] pointer-events-auto transition-opacity duration-300"
      style={{ opacity: hovered ? 0.6 : 0.2 }}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      <div className="flex flex-col gap-1.5 px-3 py-2 rounded-modal bg-secondary/80 border border-primary/10 backdrop-blur-sm">
        {ENTRIES.map((style) => (
          <div key={style.label} className="flex items-center gap-2">
            <svg width={28} height={6} className="shrink-0">
              <line
                x1={0}
                y1={3}
                x2={28}
                y2={3}
                stroke={style.stroke}
                strokeWidth={style.strokeWidth}
                strokeDasharray={style.strokeDasharray}
                strokeLinecap="round"
              />
            </svg>
            <span className="text-sm font-medium text-muted-foreground/90 leading-none whitespace-nowrap">
              {style.label}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
