interface GlyphProps {
  className?: string;
  size?: number;
}

export function PolicyGlyph({ className, size = 14 }: GlyphProps) {
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
      <path
        d="M7 1.3 2.4 2.7v3.6c0 2.7 1.9 4.6 4.6 5.4 2.7-0.8 4.6-2.7 4.6-5.4V2.7L7 1.3z"
        fill="currentColor"
        fillOpacity="0.18"
        stroke="currentColor"
        strokeWidth="1.05"
        strokeLinejoin="round"
      />
      <path
        d="M5.4 7.6l3-3"
        stroke="currentColor"
        strokeWidth="1.1"
        strokeLinecap="round"
      />
      <rect
        x="7.7"
        y="3.5"
        width="2"
        height="1.4"
        rx="0.3"
        transform="rotate(45 8.7 4.2)"
        fill="currentColor"
      />
      <rect
        x="4.2"
        y="7.0"
        width="2"
        height="1.4"
        rx="0.3"
        transform="rotate(45 5.2 7.7)"
        fill="currentColor"
      />
      <path
        d="M3.6 9.8h4.6"
        stroke="currentColor"
        strokeWidth="1.1"
        strokeLinecap="round"
      />
    </svg>
  );
}
