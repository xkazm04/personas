// Geometry-matched ghost rows for the Trace matrix cold load (loading pattern
// v2 §C: calm fade-in under the always-rendered chrome, no pulse).

export function TraceGhosts({ columns }: { columns: number }) {
  return (
    <div aria-hidden className="flex flex-col gap-1.5 pt-1">
      {Array.from({ length: 7 }, (_, i) => (
        <div
          key={i}
          className="flex items-center gap-3 animate-fade-in"
          style={{ animationDelay: `${120 + i * 35}ms` }}
        >
          <div className="w-52 h-6 rounded-interactive bg-primary/[0.06]" />
          {Array.from({ length: Math.max(1, columns) }, (_, j) => (
            <div key={j} className="w-[30px] h-6 rounded-interactive bg-primary/[0.06]" />
          ))}
        </div>
      ))}
    </div>
  );
}
