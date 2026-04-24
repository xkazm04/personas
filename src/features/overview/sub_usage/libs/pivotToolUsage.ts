type ToolUsageOverTimePoint = {
  date: string;
  tool_name: string;
  invocations: number;
};

/**
 * Pivots a long-format tool-usage time-series (one row per date × tool)
 * into wide-format rows keyed by date, suitable for a Recharts stacked
 * AreaChart.
 *
 * Zero-fills missing (date, tool) cells so the chart never encounters
 * `undefined` values (which would render NaN tooltips and cause visual
 * jumps in stacked areas). Duplicate rows for the same date/tool pair
 * are summed.
 *
 * @param toolUsageOverTime Long-format rows of `{ date, tool_name, invocations }`.
 * @returns `{ areaData, allToolNames }` where `areaData` is an
 *          ascending-date-sorted array of `{ date, [toolName]: number }`
 *          rows and `allToolNames` lists every tool seen. Empty input
 *          returns `{ areaData: [], allToolNames: [] }`.
 */
export function pivotToolUsageOverTime(toolUsageOverTime: ToolUsageOverTimePoint[]) {
  if (!toolUsageOverTime.length) {
    return { areaData: [] as Array<{ date: string } & Record<string, number>>, allToolNames: [] as string[] };
  }

  const dateMap = new Map<string, Record<string, number>>();
  const names = new Set<string>();

  for (const row of toolUsageOverTime) {
    names.add(row.tool_name);
    if (!dateMap.has(row.date)) dateMap.set(row.date, {});
    const entry = dateMap.get(row.date)!;
    entry[row.tool_name] = (entry[row.tool_name] || 0) + row.invocations;
  }

  const allToolNames = Array.from(names);

  // Zero-fill: ensure every date has an entry for every tool so Recharts
  // stacked AreaChart never sees undefined keys (which cause NaN tooltips
  // and visual jumps).
  for (const entry of dateMap.values()) {
    for (const name of allToolNames) {
      if (!(name in entry)) entry[name] = 0;
    }
  }

  const sortedDates = Array.from(dateMap.keys()).sort();
  return {
    areaData: sortedDates.map((date) => ({ date, ...dateMap.get(date) })),
    allToolNames,
  };
}
