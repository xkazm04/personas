/* ------------------------------------------------------------------ *
 *  Decorative SVGs for each Twin sub-page header.
 *  Static (no infinite motion) — they sit behind the title at low
 *  opacity to give every page its own visual signature.
 * ------------------------------------------------------------------ */

/** Constellation of stars + radial glow — Profiles. */
export function ConstellationDecoration() {
  return (
    <svg viewBox="0 0 800 200" className="w-full h-full" preserveAspectRatio="none">
      <defs>
        <radialGradient id="twin-constellation-glow" cx="20%" cy="50%" r="40%">
          <stop offset="0%" stopColor="#a78bfa" stopOpacity="0.25" />
          <stop offset="100%" stopColor="#a78bfa" stopOpacity="0" />
        </radialGradient>
      </defs>
      <rect width="800" height="200" fill="url(#twin-constellation-glow)" />
      {Array.from({ length: 14 }).map((_, i) => (
        <circle
          key={i}
          cx={120 + i * 50}
          cy={30 + (i % 3) * 50}
          r={1.4 + (i % 4) * 0.6}
          fill="#a78bfa"
          opacity={0.35 - (i % 5) * 0.05}
        />
      ))}
    </svg>
  );
}

/** Concentric circles for Identity (manuscript / signet). */
export function ManuscriptDecoration() {
  return (
    <svg viewBox="0 0 800 200" className="w-full h-full" preserveAspectRatio="xMaxYMid slice">
      <g transform="translate(700 100)" stroke="currentColor" fill="none" strokeWidth="0.6" className="text-violet-300">
        {[18, 36, 54, 72, 90].map((r, i) => (
          <circle key={i} r={r} opacity={0.45 - i * 0.08} />
        ))}
        <line x1="-90" y1="0" x2="90" y2="0" opacity="0.2" />
        <line x1="0" y1="-90" x2="0" y2="90" opacity="0.2" />
      </g>
    </svg>
  );
}

/** Static sound waveform — Tone. Stroke colour comes from currentColor. */
export function WaveformDecoration() {
  return (
    <svg className="w-full h-full" viewBox="0 0 1200 120" preserveAspectRatio="none">
      <path
        d="M0,60 Q 50,30 100,60 T 200,60 T 300,60 T 400,60 T 500,60 T 600,60 T 700,60 T 800,60 T 900,60 T 1000,60 T 1100,60 T 1200,60"
        stroke="currentColor"
        strokeWidth="1"
        fill="none"
      />
      <path
        d="M0,60 Q 50,80 100,60 T 200,60 T 300,60 T 400,60 T 500,60 T 600,60 T 700,60 T 800,60 T 900,60 T 1000,60 T 1100,60 T 1200,60"
        stroke="currentColor"
        strokeWidth="1"
        fill="none"
        opacity="0.5"
      />
    </svg>
  );
}

/** Concentric brain pattern — Brain. */
export function BrainDecoration() {
  return (
    <svg className="w-full h-full" viewBox="0 0 600 200" preserveAspectRatio="xMaxYMid slice">
      <defs>
        <linearGradient id="twin-brain-stroke" x1="0%" y1="0%" x2="100%" y2="0%">
          <stop offset="0%" stopColor="#a78bfa" stopOpacity="0.6" />
          <stop offset="50%" stopColor="#22d3ee" stopOpacity="0.5" />
          <stop offset="100%" stopColor="#f472b6" stopOpacity="0.5" />
        </linearGradient>
      </defs>
      <g transform="translate(440 100)" stroke="url(#twin-brain-stroke)" fill="none" strokeWidth="0.7">
        <circle r="80" />
        <circle r="60" />
        <circle r="40" />
        <circle r="20" />
        <line x1="-80" y1="0" x2="80" y2="0" />
        <line x1="0" y1="-80" x2="0" y2="80" />
        <line x1="-56" y1="-56" x2="56" y2="56" />
        <line x1="-56" y1="56" x2="56" y2="-56" />
      </g>
      <g fill="#a78bfa">
        {Array.from({ length: 20 }).map((_, i) => {
          const angle = (i / 20) * 2 * Math.PI;
          const x = 440 + Math.cos(angle) * 80;
          const y = 100 + Math.sin(angle) * 80;
          return <circle key={i} cx={x} cy={y} r={1.5} opacity={0.6} />;
        })}
      </g>
    </svg>
  );
}

/** Stylised library shelves — Knowledge. */
export function ArchiveDecoration() {
  return (
    <svg className="w-full h-full" viewBox="0 0 800 200" preserveAspectRatio="xMaxYMid slice">
      {Array.from({ length: 5 }).map((_, row) => (
        <g key={row} transform={`translate(0 ${row * 40})`}>
          <line x1="0" y1="20" x2="800" y2="20" stroke="#a78bfa" strokeWidth="0.5" opacity="0.3" />
          {Array.from({ length: 40 }).map((_, i) => (
            <rect
              key={i}
              x={i * 20 + (row % 2) * 4}
              y={5}
              width={3 + (i % 5)}
              height={14}
              fill={i % 3 === 0 ? '#a78bfa' : i % 4 === 0 ? '#22d3ee' : '#fbbf24'}
              opacity={0.32}
            />
          ))}
        </g>
      ))}
    </svg>
  );
}

/** Broadcast wave rings — Channels. */
export function AntennaDecoration() {
  return (
    <svg className="w-full h-full" viewBox="0 0 800 200" preserveAspectRatio="xMaxYMid slice">
      {[80, 60, 40, 20].map((r, i) => (
        <path
          key={i}
          d={`M 740,100 m -${r},0 a ${r},${r} 0 1,0 ${r * 2},0`}
          stroke="#a78bfa"
          strokeWidth="0.7"
          fill="none"
          opacity={0.45 - i * 0.08}
        />
      ))}
      <circle cx="740" cy="100" r="3" fill="#a78bfa" />
    </svg>
  );
}
