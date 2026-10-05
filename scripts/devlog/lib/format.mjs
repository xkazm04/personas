// Plain-text rendering for an LLM reader: one line per row, aligned columns,
// no colour, no box drawing. Long cells are cut with `...`.

const MSG_WIDTH = 72;
const VALUE_WIDTH = 24;
const MAX_FIELDS = 3;

export function cut(text, width) {
  const s = String(text ?? "").replace(/\s+/g, " ").trim();
  return s.length > width ? s.slice(0, Math.max(0, width - 3)) + "..." : s;
}

/** A record's message with up to three abbreviated fields. */
export function sampleOf(rec, { skip = [] } = {}) {
  const parts = [rec.msg ?? ""];
  let n = 0;
  for (const [k, v] of Object.entries(rec.f ?? {})) {
    if (skip.includes(k) || k === "detail" || k === "legacy_tgt" || k === "stack") continue;
    if (n >= MAX_FIELDS) break;
    const val = typeof v === "object" ? JSON.stringify(v) : String(v);
    parts.push(`${k}=${cut(val, VALUE_WIDTH)}`);
    n += 1;
  }
  return parts.join(" ").trim();
}

export function num(n, digits = 0) {
  if (n === undefined || n === null || Number.isNaN(n)) return "-";
  return digits ? Number(n).toFixed(digits) : String(Math.round(n));
}

export function isoShort(ms) {
  if (!Number.isFinite(ms)) return "-";
  return new Date(ms).toISOString().slice(0, 19) + "Z";
}

export function duration(ms) {
  if (!Number.isFinite(ms) || ms < 0) return "-";
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s}s`;
  if (s < 3600) return `${Math.floor(s / 60)}m${String(s % 60).padStart(2, "0")}s`;
  return `${Math.floor(s / 3600)}h${String(Math.floor((s % 3600) / 60)).padStart(2, "0")}m`;
}

/** Render rows (objects) under `columns` as aligned text lines. */
export function table(columns, rows) {
  const cells = rows.map((row) =>
    columns.map((c) => {
      const v = row[c];
      const s = v === undefined || v === null || v === "" ? "-" : String(v);
      return c === "msg" ? cut(s, MSG_WIDTH) : s;
    }),
  );
  const widths = columns.map((c, i) => Math.max(c.length, ...cells.map((r) => r[i].length)));
  const numeric = columns.map((_, i) => cells.length > 0 && cells.every((r) => /^-?[\d.,]+$|^-$/.test(r[i])));
  const line = (vals) =>
    vals
      .map((v, i) => {
        if (i === vals.length - 1) return v;
        return numeric[i] ? v.padStart(widths[i]) : v.padEnd(widths[i]);
      })
      .join("  ")
      .trimEnd();
  return [line(columns), ...cells.map(line)];
}
