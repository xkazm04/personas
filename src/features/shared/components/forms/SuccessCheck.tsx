/**
 * 16×16 SVG checkmark whose stroke draws in via the `.animate-draw-check`
 * keyframe defined in globals.css.  Renders only when `visible` is true.
 */
export function SuccessCheck({ visible }: { visible: boolean }) {
  if (!visible) return null;

  return (
    <svg
      width={16}
      height={16}
      viewBox="0 0 16 16"
      fill="none"
      aria-hidden="true"
      className="inline-block align-text-bottom text-emerald-400"
    >
      <path
        d="M3 8.5 6.5 12 13 4"
        stroke="currentColor"
        strokeWidth={2}
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeDasharray={24}
        strokeDashoffset={0}
        className="animate-draw-check"
      />
    </svg>
  );
}
