// Stands in for a real primitive that legitimately owns the banned construct
// (the way ThemedSelect owns <select> and AsyncButton owns its spinner).
// fx-storage EXCLUDES this file, so its 2 storage matches must not be counted.
// fx-spinner and fx-select do NOT exclude it, so their matches here must be.

export function Primitive() {
  const a = localStorage.getItem('primitive');
  localStorage.setItem('primitive', '1');
  return (
    <div className="animate-spin">
      <select defaultValue={a ?? ''} />
    </div>
  );
}
