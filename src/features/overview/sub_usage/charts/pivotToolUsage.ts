type ToolUsageOverTimePoint = {
  date: string;
  tool_name: string;
  invocations: number;
};

/**
 * Pivots a long-format tool-usage time-series (one row per date × tool)
 * into wide-format rows keyed by date, suitable for a Recharts stacked
 * AreaChart. Duplicate rows for the same date/tool pair are summed.
 *
 * Note: unlike the `libs/` sibling, this variant does NOT zero-fill
 * missing (date, tool) cells, so consumers must tolerate `undefined`
 * values when a tool is absent on a given date.
 *
 * @param toolUsageOverTime Long-format rows of `{ date, tool_name, invocations }`.
 * @returns `{ areaData, allToolNames }` where `areaData` is an
 *          ascending-date-sorted array of `{ date, [toolName]?: number }`
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

  const sortedDates = Array.from(dateMap.keys()).sort();
  return {
    areaData: sortedDates.map((date) => ({ date, ...dateMap.get(date) })),
    allToolNames: Array.from(names),
  };
}
