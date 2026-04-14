export const fmtCost = (v: number) =>
  v >= 0 && v < 0.01 ? '<$0.01' : `$${v.toFixed(2)}`;
export const fmtMs = (v: number) => v >= 1000 ? `${(v / 1000).toFixed(1)}s` : `${Math.round(v)}ms`;
export const fmtDate = (d: string) => {
  const dt = new Date(d + 'T00:00:00');
  return dt.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
};
