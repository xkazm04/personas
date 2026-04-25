interface GlyphProps {
  className?: string;
  size?: number;
}

export function RuntimeGlyph({ className, size = 14 }: GlyphProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 14 14"
      fill="none"
      className={className}
      aria-hidden="true"
      role="presentation"
    >
      <circle
        cx="7"
        cy="7"
        r="5.6"
        fill="none"
        stroke="currentColor"
        strokeWidth="1"
        strokeOpacity="0.55"
        strokeDasharray="2.2 1.4"
      />
      <circle
        cx="7"
        cy="7"
        r="5.6"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.1"
        strokeOpacity="0.95"
        strokeLinecap="round"
        pathLength="100"
        strokeDasharray="32 100"
      />
      <path
        d="M7.6 3.2L4.2 7.7h2.3l-0.5 3.1 3.4-4.5h-2.3z"
        fill="currentColor"
        stroke="currentColor"
        strokeWidth="0.4"
        strokeLinejoin="round"
      />
    </svg>
  );
}
