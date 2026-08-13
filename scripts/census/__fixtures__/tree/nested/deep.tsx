// Proves the walk recurses. Counts asserted by self-test.mjs:
// 1 storage match, 1 spinner match, 1 select match.
// The <select below sits at END OF LINE on purpose — that is the shape a
// line-by-line matcher silently misses (63 of this repo's 67 raw selects).

export function Deep() {
  const value = sessionStorage.getItem('deep');
  return (
    <div className="animate-spin">
      <select
        value={value ?? ''}
        onChange={() => undefined}
      />
    </div>
  );
}
