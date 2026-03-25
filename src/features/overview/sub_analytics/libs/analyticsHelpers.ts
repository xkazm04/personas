export function formatToolName(name: string): string {
  return name
    .replace(/_/g, ' ')
    .split(' ')
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');
}

const DATE_LABEL_OPTS: Intl.DateTimeFormatOptions = { month: 'short', day: 'numeric' };

export function formatDateTick(dateStr: string): string {
  const d = dateStr.includes('T') ? new Date(dateStr) : new Date(dateStr + 'T00:00:00');
  return d.toLocaleDateString(undefined, DATE_LABEL_OPTS);
}
