/**
 * The cold-load ghost: the spine's geometry, painted only into emptiness and only after a beat,
 * so a warm read never flashes it (loading pattern v2).
 */
export function ProcessGhost() {
  return (
    <div className="animate-fade-in space-y-10" style={{ animationDelay: '150ms', animationFillMode: 'backwards' }} aria-hidden="true">
      <div className="grid grid-cols-3 gap-6 border-b border-primary/10 pb-8">
        {[0, 1, 2].map((i) => (
          <span key={i} className="block h-14 rounded bg-primary/[0.06]" />
        ))}
      </div>
      {[0, 1, 2, 3, 4].map((i) => (
        <div key={i} className="grid grid-cols-[minmax(9rem,13rem)_4.5rem_minmax(0,1fr)] gap-x-8">
          <span className="ml-auto block h-7 w-28 rounded bg-primary/[0.06]" />
          <span className="mx-auto block h-24 w-8 rounded bg-primary/[0.06]" />
          <span className="block h-16 rounded bg-primary/[0.06]" />
        </div>
      ))}
    </div>
  );
}
