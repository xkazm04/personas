/**
 * Custom SVG icons for the Persona Matrix grid cells.
 * Each icon is designed as a semitransparent watermark background.
 * Based on Leonardo AI-generated reference artwork, hand-drawn as scalable SVG.
 */

interface IconProps {
  className?: string;
}

/** Crosshair with 4 directional arrows and endpoint dots */
export function UseCasesIcon({ className }: IconProps) {
  return (
    <svg viewBox="0 0 64 64" fill="none" className={className}>
      {/* Center circle */}
      <circle cx="32" cy="32" r="9" stroke="currentColor" strokeWidth="1.8" />
      {/* Vertical line + arrows */}
      <line x1="32" y1="10" x2="32" y2="23" stroke="currentColor" strokeWidth="1.5" />
      <line x1="32" y1="41" x2="32" y2="54" stroke="currentColor" strokeWidth="1.5" />
      <polyline points="29,14 32,10 35,14" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
      <polyline points="29,50 32,54 35,50" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
      {/* Horizontal line + arrows */}
      <line x1="10" y1="32" x2="23" y2="32" stroke="currentColor" strokeWidth="1.5" />
      <line x1="41" y1="32" x2="54" y2="32" stroke="currentColor" strokeWidth="1.5" />
      <polyline points="14,29 10,32 14,35" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
      <polyline points="50,29 54,32 50,35" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
      {/* Endpoint dots */}
      <circle cx="10" cy="32" r="1.5" fill="currentColor" />
      <circle cx="54" cy="32" r="1.5" fill="currentColor" />
      <circle cx="32" cy="10" r="1.5" fill="currentColor" />
      <circle cx="32" cy="54" r="1.5" fill="currentColor" />
    </svg>
  );
}

/** Hub-and-spoke network with center node and 6 outer nodes */
export function ConnectorsIcon({ className }: IconProps) {
  return (
    <svg viewBox="0 0 64 64" fill="none" className={className}>
      {/* Spokes */}
      <line x1="32" y1="32" x2="32" y2="12" stroke="currentColor" strokeWidth="1.4" />
      <line x1="32" y1="32" x2="49" y2="22" stroke="currentColor" strokeWidth="1.4" />
      <line x1="32" y1="32" x2="49" y2="42" stroke="currentColor" strokeWidth="1.4" />
      <line x1="32" y1="32" x2="32" y2="52" stroke="currentColor" strokeWidth="1.4" />
      <line x1="32" y1="32" x2="15" y2="42" stroke="currentColor" strokeWidth="1.4" />
      <line x1="32" y1="32" x2="15" y2="22" stroke="currentColor" strokeWidth="1.4" />
      {/* Center node */}
      <circle cx="32" cy="32" r="3" stroke="currentColor" strokeWidth="1.5" />
      {/* Outer nodes */}
      <circle cx="32" cy="12" r="3.5" stroke="currentColor" strokeWidth="1.3" />
      <circle cx="49" cy="22" r="3.5" stroke="currentColor" strokeWidth="1.3" />
      <circle cx="49" cy="42" r="3.5" stroke="currentColor" strokeWidth="1.3" />
      <circle cx="32" cy="52" r="3.5" stroke="currentColor" strokeWidth="1.3" />
      <circle cx="15" cy="42" r="3.5" stroke="currentColor" strokeWidth="1.3" />
      <circle cx="15" cy="22" r="3.5" stroke="currentColor" strokeWidth="1.3" />
    </svg>
  );
}

/** Lightning bolt with pulse wave arcs on each side */
export function TriggersIcon({ className }: IconProps) {
  return (
    <svg viewBox="0 0 64 64" fill="none" className={className}>
      {/* Lightning bolt */}
      <path
        d="M35 12 L27 32 L33 32 L29 52 L41 28 L34 28 Z"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinejoin="round"
        strokeLinecap="round"
      />
      {/* Left pulse arcs */}
      <path d="M20 26 Q16 32 20 38" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" fill="none" />
      <path d="M15 23 Q10 32 15 41" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" fill="none" />
      {/* Right pulse arcs */}
      <path d="M44 26 Q48 32 44 38" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" fill="none" />
      <path d="M49 23 Q54 32 49 41" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" fill="none" />
    </svg>
  );
}

/** Almond eye shape with circle iris containing a checkmark */
export function HumanReviewIcon({ className }: IconProps) {
  return (
    <svg viewBox="0 0 64 64" fill="none" className={className}>
      {/* Eye outline -- almond shape */}
      <path
        d="M8 32 Q20 18 32 18 Q44 18 56 32 Q44 46 32 46 Q20 46 8 32 Z"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinejoin="round"
      />
      {/* Iris circle */}
      <circle cx="32" cy="32" r="8" stroke="currentColor" strokeWidth="1.5" />
      {/* Checkmark inside iris */}
      <polyline
        points="27,32 30,36 37,28"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

/** Two overlapping speech bubbles with signal dots */
export function MessagesIcon({ className }: IconProps) {
  return (
    <svg viewBox="0 0 64 64" fill="none" className={className}>
      {/* Back bubble (larger) */}
      <path
        d="M10 16 H40 Q44 16 44 20 V32 Q44 36 40 36 H18 L12 42 V36 H10 Q6 36 6 32 V20 Q6 16 10 16 Z"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinejoin="round"
      />
      {/* Front bubble (smaller, offset) */}
      <path
        d="M28 38 H50 Q54 38 54 42 V50 Q54 54 50 54 H52 V58 L46 54 H28 Q24 54 24 50 V42 Q24 38 28 38 Z"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinejoin="round"
      />
      {/* Typing dots in back bubble */}
      <circle cx="18" cy="26" r="1.5" fill="currentColor" />
      <circle cx="25" cy="26" r="1.5" fill="currentColor" />
      <circle cx="32" cy="26" r="1.5" fill="currentColor" />
      {/* Signal arcs near front bubble */}
      <path d="M56 40 Q59 44 56 48" stroke="currentColor" strokeWidth="1" strokeLinecap="round" />
    </svg>
  );
}

/** Brain hemisphere with circuit traces and data node dots */
export function MemoryIcon({ className }: IconProps) {
  return (
    <svg viewBox="0 0 64 64" fill="none" className={className}>
      {/* Left brain outline */}
      <path
        d="M32 12 Q18 12 14 22 Q10 30 14 38 Q16 44 20 48 Q24 52 32 54"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        fill="none"
      />
      {/* Right brain outline */}
      <path
        d="M32 12 Q46 12 50 22 Q54 30 50 38 Q48 44 44 48 Q40 52 32 54"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        fill="none"
      />
      {/* Center divide */}
      <line x1="32" y1="14" x2="32" y2="52" stroke="currentColor" strokeWidth="1" />
      {/* Left circuit traces */}
      <path d="M28 22 V30 H22" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
      <path d="M26 34 V42" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
      {/* Right circuit traces */}
      <path d="M36 20 V28 H42" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
      <path d="M38 34 V40 H44" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
      {/* Data nodes */}
      <circle cx="28" cy="22" r="1.5" fill="currentColor" />
      <circle cx="22" cy="30" r="1.5" fill="currentColor" />
      <circle cx="26" cy="42" r="1.5" fill="currentColor" />
      <circle cx="36" cy="20" r="1.5" fill="currentColor" />
      <circle cx="42" cy="28" r="1.5" fill="currentColor" />
      <circle cx="44" cy="40" r="1.5" fill="currentColor" />
      <circle cx="38" cy="34" r="1.5" fill="currentColor" />
    </svg>
  );
}

/** Shield outline with triangle alert and exclamation mark */
export function ErrorsIcon({ className }: IconProps) {
  return (
    <svg viewBox="0 0 64 64" fill="none" className={className}>
      {/* Shield outline */}
      <path
        d="M32 8 L52 18 V34 Q52 48 32 58 Q12 48 12 34 V18 Z"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinejoin="round"
      />
      {/* Alert triangle */}
      <path
        d="M32 24 L40 40 H24 Z"
        stroke="currentColor"
        strokeWidth="1.3"
        strokeLinejoin="round"
      />
      {/* Exclamation mark */}
      <line x1="32" y1="29" x2="32" y2="35" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      <circle cx="32" cy="38" r="1" fill="currentColor" />
    </svg>
  );
}

/** Concentric radio signal arcs emanating from center point */
export function EventsIcon({ className }: IconProps) {
  return (
    <svg viewBox="0 0 64 64" fill="none" className={className}>
      {/* Center dot */}
      <circle cx="32" cy="32" r="3" fill="currentColor" />
      {/* Inner ring */}
      <circle cx="32" cy="32" r="10" stroke="currentColor" strokeWidth="1.5" />
      {/* Outer ring */}
      <circle cx="32" cy="32" r="19" stroke="currentColor" strokeWidth="1.3" />
      {/* Outermost partial arcs for broadcast feel */}
      <path d="M32 6 A26 26 0 0 1 58 32" stroke="currentColor" strokeWidth="1" strokeLinecap="round" />
      <path d="M58 32 A26 26 0 0 1 32 58" stroke="currentColor" strokeWidth="1" strokeLinecap="round" />
      <path d="M32 58 A26 26 0 0 1 6 32" stroke="currentColor" strokeWidth="1" strokeLinecap="round" />
      <path d="M6 32 A26 26 0 0 1 32 6" stroke="currentColor" strokeWidth="1" strokeLinecap="round" />
    </svg>
  );
}
