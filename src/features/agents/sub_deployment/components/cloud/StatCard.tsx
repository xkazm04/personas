export function StatCard({ label, value, hint, color }: { label: string; value: string; hint?: string; color?: 'emerald' | 'amber' | 'red' }) {
  const colorMap: Record<string, string> = {
    emerald: 'text-status-success',
    amber: 'text-status-warning',
    red: 'text-status-error',
  };

  return (
    <div className="p-3 rounded-modal bg-surface-1 border border-hair text-center">
      <p className="typo-caption text-ink-2 mb-1">{label}</p>
      <p className={`typo-heading-lg ${color ? colorMap[color] : 'text-ink-1'}`}>{value}</p>
      {/* A second line for the figure that qualifies the first one (a pace, a
          coverage caveat). Absent by default so every other card is unchanged. */}
      {hint && <p className="typo-caption text-ink-2 mt-0.5">{hint}</p>}
    </div>
  );
}
