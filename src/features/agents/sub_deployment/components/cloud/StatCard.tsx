export function StatCard({ label, value, hint, color }: { label: string; value: string; hint?: string; color?: 'emerald' | 'amber' | 'red' }) {
  const colorMap: Record<string, string> = {
    emerald: 'text-emerald-400',
    amber: 'text-amber-400',
    red: 'text-red-400',
  };

  return (
    <div className="p-3 rounded-modal bg-secondary/30 border border-primary/10 text-center">
      <p className="typo-caption text-foreground mb-1">{label}</p>
      <p className={`typo-heading-lg ${color ? colorMap[color] : 'text-foreground/90'}`}>{value}</p>
      {/* A second line for the figure that qualifies the first one (a pace, a
          coverage caveat). Absent by default so every other card is unchanged. */}
      {hint && <p className="typo-caption text-foreground mt-0.5">{hint}</p>}
    </div>
  );
}
