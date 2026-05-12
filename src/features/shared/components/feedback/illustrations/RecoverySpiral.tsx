interface RecoverySpiralProps {
  /** Width in px. Defaults to 240. */
  width?: number;
  /** Height in px. Defaults to 180. */
  height?: number;
  /** Override class — apply text-* color so currentColor inherits the success token. */
  className?: string;
  /** Override aria-label; pass empty string for decorative use. */
  ariaLabel?: string;
}

export function RecoverySpiral({
  width = 240,
  height = 180,
  className = 'text-emerald-400',
  ariaLabel,
}: RecoverySpiralProps) {
  const decorative = ariaLabel === '' || ariaLabel === undefined;
  return (
    <svg
      viewBox="0 0 240 180"
      width={width}
      height={height}
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      role={decorative ? 'presentation' : 'img'}
      aria-label={decorative ? undefined : ariaLabel}
      aria-hidden={decorative ? true : undefined}
      className={className}
    >
      <path d="M 140 45 A 50 50 0 1 1 100 45" />
      <path d="M 100 45 L 91 39 M 100 45 L 102 56" />
      <circle cx={120} cy={80} r={11} />
      <path d="M 100 122 Q 100 100 120 100 Q 140 100 140 122" />
    </svg>
  );
}
