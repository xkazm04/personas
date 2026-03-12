/**
 * Branded "thinking" loader -- a geometric persona silhouette head
 * with orbiting dots in violet-400 / blue-400.
 *
 * Pure CSS animations (keyframes + transform/opacity), zero JS runtime cost.
 */

const KEYFRAMES = `
@keyframes tl-orbit {
  0%   { transform: rotate(0deg)   translateX(11px) rotate(0deg);   opacity: 0.85; }
  50%  { opacity: 1; }
  100% { transform: rotate(360deg) translateX(11px) rotate(-360deg); opacity: 0.85; }
}
@keyframes tl-orbit-reverse {
  0%   { transform: rotate(180deg) translateX(11px) rotate(-180deg); opacity: 0.7; }
  50%  { opacity: 1; }
  100% { transform: rotate(-180deg) translateX(11px) rotate(180deg); opacity: 0.7; }
}
@keyframes tl-pulse-head {
  0%, 100% { opacity: 0.7; }
  50%      { opacity: 0.95; }
}
`;

let injected = false;
function injectKeyframes() {
  if (injected || typeof document === 'undefined') return;
  injected = true;
  const style = document.createElement('style');
  style.textContent = KEYFRAMES;
  document.head.appendChild(style);
}

interface ThinkingLoaderProps {
  /** px size of the SVG viewBox (default 32) */
  size?: number;
  className?: string;
}

export function ThinkingLoader({ size = 32, className = '' }: ThinkingLoaderProps) {
  injectKeyframes();

  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 32 32"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
      aria-hidden="true"
    >
      {/* Head -- rounded rectangle silhouette */}
      <rect
        x="10"
        y="7"
        width="12"
        height="14"
        rx="5"
        fill="currentColor"
        className="text-violet-400/30"
        style={{ animation: 'tl-pulse-head 2.4s ease-in-out infinite' }}
      />
      {/* Neck / body hint */}
      <rect
        x="13"
        y="20"
        width="6"
        height="5"
        rx="2"
        fill="currentColor"
        className="text-violet-400/20"
      />

      {/* Orbiting dot 1 -- violet */}
      <circle
        cx="16"
        cy="14"
        r="2"
        fill="currentColor"
        className="text-violet-400"
        style={{ animation: 'tl-orbit 2s linear infinite', transformOrigin: '16px 14px' }}
      />
      {/* Orbiting dot 2 -- blue, reverse direction */}
      <circle
        cx="16"
        cy="14"
        r="1.5"
        fill="currentColor"
        className="text-blue-400"
        style={{ animation: 'tl-orbit-reverse 2.8s linear infinite', transformOrigin: '16px 14px' }}
      />
    </svg>
  );
}
