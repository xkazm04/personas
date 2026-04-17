export function StatCard({ label, value, color }: { label: string; value: string; color?: 'emerald' | 'amber' | 'red' }) {
  const colorMap: Record<string, string> = {
    emerald: 'text-emerald-400',
    amber: 'text-amber-400',
    red: 'text-red-400',
  };

  return (
    <div className="p-3 rounded-modal bg-secondary/30 border border-primary/10 text-center">
      <p className="text-xs text-foreground mb-1">{label}</p>
      <p className={`text-lg font-semibold ${color ? colorMap[color] : 'text-foreground/90'}`}>{value}</p>
    </div>
  );
}
