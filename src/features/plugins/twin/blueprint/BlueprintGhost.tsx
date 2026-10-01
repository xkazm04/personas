/**
 * The blueprint while its model or its variant chunk loads: four section-shaped
 * outlines in the geometry the drawing will take, under chrome that is already
 * painted (loading pattern v2). The fade-in is delayed so a fast read never
 * paints a ghost at all, and nothing here moves after it appears.
 */
const SECTION_SLOTS = [0, 1, 2, 3] as const;

export function BlueprintGhost({ testId = 'twin-blueprint-ghost' }: { testId?: string }) {
  return (
    <div className="flex-1 min-h-0 grid grid-cols-2 grid-rows-2 gap-4 p-6" aria-hidden data-testid={testId}>
      {SECTION_SLOTS.map((i) => (
        <div
          key={i}
          className="animate-fade-in rounded-card border border-dashed border-primary/15 bg-secondary/20 p-5 flex flex-col gap-3"
          style={{ animationDelay: `${140 + i * 60}ms` }}
        >
          <span className="block h-4 w-28 rounded-interactive bg-secondary/50" />
          <span className="block flex-1 rounded-card bg-secondary/30" />
        </div>
      ))}
    </div>
  );
}

export default BlueprintGhost;
