import type { ReactNode } from "react";

interface ChipProps {
  icon?: ReactNode;
  label: string;
  value?: string;
  resolved?: boolean;
  placeholder?: string;
  testId?: string;
  tone?: "neutral" | "primary" | "warn";
}

export function Chip({
  icon,
  label,
  value,
  resolved = false,
  placeholder,
  testId,
  tone = "neutral",
}: ChipProps) {
  const display = value || placeholder || "";

  const resolvedToneClasses: Record<typeof tone, string> = {
    neutral: "bg-secondary/50 text-foreground",
    primary: "bg-primary/15 text-primary",
    warn: "bg-amber-500/15 text-amber-400",
  };
  const pendingClasses = "bg-secondary/20 text-foreground/45";

  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 typo-caption ${
        resolved ? resolvedToneClasses[tone] : pendingClasses
      }`}
      data-testid={testId}
      data-resolved={resolved}
    >
      {icon}
      <span className="font-medium">{label}</span>
      {display ? (
        <span className="truncate max-w-[140px] opacity-80">· {display}</span>
      ) : null}
    </span>
  );
}
