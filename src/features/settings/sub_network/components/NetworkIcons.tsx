import type { SVGProps } from 'react';

type IconProps = SVGProps<SVGSVGElement>;

/**
 * Hexagonal shield with fingerprint motif — verified/trusted peer.
 * Default color: emerald-400 (#34d399)
 */
export function TrustVerifiedIcon(props: IconProps) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      {...props}
    >
      {/* Hexagonal shield */}
      <path
        d="M12 2L20 6.5V12C20 16.42 16.64 20.44 12 22C7.36 20.44 4 16.42 4 12V6.5L12 2Z"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinejoin="round"
        fill="currentColor"
        fillOpacity={0.1}
      />
      {/* Fingerprint arcs */}
      <path
        d="M12 9C10.34 9 9 10.34 9 12C9 13.1 9.6 14.05 10.5 14.55"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
      />
      <path
        d="M12 11C11.45 11 11 11.45 11 12V14"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
      />
      <path
        d="M14 10.5C14.6 11 15 11.68 15 12.5C15 13.33 14.67 14 14 14.5"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
      />
    </svg>
  );
}

/**
 * Hexagonal shield with question pattern — unknown trust level.
 * Default color: amber-400 (#fbbf24)
 */
export function TrustUnknownIcon(props: IconProps) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      {...props}
    >
      {/* Hexagonal shield */}
      <path
        d="M12 2L20 6.5V12C20 16.42 16.64 20.44 12 22C7.36 20.44 4 16.42 4 12V6.5L12 2Z"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinejoin="round"
        fill="currentColor"
        fillOpacity={0.06}
      />
      {/* Question mark */}
      <path
        d="M10 9.5C10 8.12 11.12 7 12.5 7C13.88 7 15 8.12 15 9.5C15 10.88 13.88 12 12.5 12V13.5"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <circle cx="12.5" cy="16" r="0.75" fill="currentColor" />
    </svg>
  );
}

/**
 * Hexagonal shield with broken seal — revoked trust.
 * Default color: red-400 (#f87171)
 */
export function TrustRevokedIcon(props: IconProps) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      {...props}
    >
      {/* Hexagonal shield — cracked */}
      <path
        d="M12 2L20 6.5V12C20 16.42 16.64 20.44 12 22C7.36 20.44 4 16.42 4 12V6.5L12 2Z"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinejoin="round"
        strokeDasharray="3 2"
        fill="currentColor"
        fillOpacity={0.06}
      />
      {/* Diagonal slash / break */}
      <path
        d="M9 9L15 15"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
      />
      <path
        d="M15 9L9 15"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
      />
    </svg>
  );
}

/**
 * Stylised node-link graphic — connected state.
 * Default color: emerald-400 (#34d399)
 */
export function NodeConnectedIcon(props: IconProps) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      {...props}
    >
      {/* Link line */}
      <line
        x1="8"
        y1="12"
        x2="16"
        y2="12"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
      />
      {/* Left node */}
      <circle cx="6" cy="12" r="3" stroke="currentColor" strokeWidth="1.5" fill="currentColor" fillOpacity={0.15} />
      <circle cx="6" cy="12" r="1" fill="currentColor" />
      {/* Right node */}
      <circle cx="18" cy="12" r="3" stroke="currentColor" strokeWidth="1.5" fill="currentColor" fillOpacity={0.15} />
      <circle cx="18" cy="12" r="1" fill="currentColor" />
    </svg>
  );
}

/**
 * Stylised node-link graphic with gap — disconnected state.
 * Default color: zinc-400 (#a1a1aa)
 */
export function NodeDisconnectedIcon(props: IconProps) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      {...props}
    >
      {/* Broken link lines */}
      <line
        x1="8"
        y1="12"
        x2="10.5"
        y2="12"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
      />
      <line
        x1="13.5"
        y1="12"
        x2="16"
        y2="12"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
      />
      {/* Gap indicator */}
      <path
        d="M11 10.5L12 12L11 13.5"
        stroke="currentColor"
        strokeWidth="1"
        strokeLinecap="round"
        strokeLinejoin="round"
        opacity={0.5}
      />
      <path
        d="M13 10.5L12 12L13 13.5"
        stroke="currentColor"
        strokeWidth="1"
        strokeLinecap="round"
        strokeLinejoin="round"
        opacity={0.5}
      />
      {/* Left node */}
      <circle cx="6" cy="12" r="3" stroke="currentColor" strokeWidth="1.5" fill="currentColor" fillOpacity={0.08} />
      <circle cx="6" cy="12" r="1" fill="currentColor" opacity={0.5} />
      {/* Right node */}
      <circle cx="18" cy="12" r="3" stroke="currentColor" strokeWidth="1.5" fill="currentColor" fillOpacity={0.08} />
      <circle cx="18" cy="12" r="1" fill="currentColor" opacity={0.5} />
    </svg>
  );
}
