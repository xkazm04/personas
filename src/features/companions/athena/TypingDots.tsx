/**
 * TypingDots — three primary-tinted dots that bounce in sequence, shown in the
 * streaming bubble next to the live phase label so the wait reads as active
 * "thinking" rather than a static line. Decorative (aria-hidden); the phase
 * label carries the meaning for screen readers. Animation is disabled under
 * reduced motion (see globals.css → companion-typing-dot).
 */
export function TypingDots() {
  return (
    <span className="inline-flex items-center gap-1" aria-hidden>
      <span className="companion-typing-dot" />
      <span className="companion-typing-dot" />
      <span className="companion-typing-dot" />
    </span>
  );
}
