type ToolUsageOverTimePoint = {
  date: string;
  tool_name: string;
  invocations: number;
};

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
