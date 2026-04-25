interface GlyphProps {
  className?: string;
  size?: number;
}

export function ConfigGlyph({ className, size = 14 }: GlyphProps) {
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
        cx="5"
        cy="5"
        r="2.4"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.1"
      />
      <circle cx="5" cy="5" r="0.7" fill="currentColor" />
      <path
        d="M5 1.4v0.9 M5 7.7v0.9 M1.4 5h0.9 M7.7 5h0.9 M2.5 2.5l0.6 0.6 M6.9 6.9l0.6 0.6 M2.5 7.5l0.6-0.6 M6.9 3.1l0.6-0.6"
        stroke="currentColor"
        strokeWidth="1"
        strokeLinecap="round"
      />
      <path
        d="M9.7 8.6l0.5-0.5 1 1-0.5 0.5 1.4 1.4-1 1-1.4-1.4-0.5 0.5-1-1z"
        fill="currentColor"
        fillOpacity="0.9"
      />
      <circle cx="9.5" cy="8.5" r="0.4" fill="currentColor" />
    </svg>
  );
}
