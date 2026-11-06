export type Rhythm = "once" | "daily" | "weekly" | "monthly";

interface ComposerScheduleRhythmCardProps {
  rhythm: Rhythm;
  icon: React.ReactNode;
  title: string;
  caption: string;
  active: boolean;
  onSelect: () => void;
}

export function ComposerScheduleRhythmCard({
  icon, title, caption, active, onSelect,
}: ComposerScheduleRhythmCardProps) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onSelect}
      className={`group relative flex flex-col items-start gap-2 p-4 rounded-card border transition-all text-left ${
        active
          ? "border-primary/60 bg-surface-1 shadow-elevation-2"
          : "border-hair bg-surface-1 hover:border-primary/40 hover:bg-primary/[0.04]"
      }`}
    >
      <div
        className={`w-10 h-10 rounded-interactive flex items-center justify-center transition-colors ${
          active ? "bg-primary/25 text-primary" : "bg-surface-1 text-ink-1 group-hover:bg-primary/15 group-hover:text-primary"
        }`}
      >
        {icon}
      </div>
      <div>
        <div className="typo-body text-ink-1">{title}</div>
        <div className="typo-caption text-ink-2 mt-0.5">{caption}</div>
      </div>
      {active && (
        <span
          className="absolute top-3 right-3 w-2 h-2 rounded-full bg-primary"
          style={{ boxShadow: "0 0 10px rgba(96,165,250,0.8)" }}
        />
      )}
    </button>
  );
}
