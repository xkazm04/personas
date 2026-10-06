/**
 * The inset key cap. In R2-A a key is printed ONCE, inside the button that
 * does the thing; the full map lives behind the tray's Keys affordance.
 */
export function Key({ children, label }: { children: string; label?: string }) {
  return (
    <kbd className="r2a-key typo-code" aria-label={label}>
      {children}
    </kbd>
  );
}
