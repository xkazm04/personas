/** WildButton: the darkroom-styled action control. Mirrors AsyncButton's
 *  contract (synchronous in-flight guard against double clicks, a real spinner
 *  plus disabled + aria-busy while the action runs) in this layout's own skin.
 *  `busy` lets a caller keep it busy for fire-and-forget handlers whose result
 *  arrives as a phase change instead of a promise. */
import { useRef, useState, type ReactNode } from "react";
import { Loader2 } from "lucide-react";

interface WildButtonProps {
  kind?: "primary" | "ghost" | "danger";
  onClick: () => unknown;
  children: ReactNode;
  icon?: ReactNode;
  kbd?: string;
  busy?: boolean;
  busyLabel?: ReactNode;
  disabled?: boolean;
  className?: string;
  autoFocus?: boolean;
}

export function WildButton({ kind = "primary", onClick, children, icon, kbd, busy = false, busyLabel, disabled, className = "", autoFocus }: WildButtonProps) {
  const inFlight = useRef(false);
  const [running, setRunning] = useState(false);
  const isBusy = busy || running;
  const cls = kind === "ghost" ? "csw-ghost" : "csw-btn";
  const style = kind === "danger" ? { background: "var(--cs-bad)", boxShadow: "none" } : undefined;

  const handle = () => {
    if (inFlight.current || isBusy) return;
    inFlight.current = true;
    let result: unknown;
    try { result = onClick(); } catch (err) { inFlight.current = false; throw err; }
    if (result && typeof (result as { then?: unknown }).then === "function") {
      setRunning(true);
      void Promise.resolve(result).finally(() => { inFlight.current = false; setRunning(false); });
    } else {
      inFlight.current = false;
    }
  };

  return (
    <button
      type="button"
      className={`${cls} ${className}`.trim()}
      style={style}
      onClick={handle}
      disabled={disabled || isBusy}
      aria-busy={isBusy || undefined}
      autoFocus={autoFocus}
    >
      {isBusy ? <Loader2 className="w-4 h-4 animate-spin" aria-hidden /> : icon}
      {isBusy && busyLabel ? busyLabel : children}
      {kbd && !isBusy && <span className="csw-kbd">{kbd}</span>}
    </button>
  );
}
