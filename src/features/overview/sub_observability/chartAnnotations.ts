export type AnnotationType = 'prompt' | 'healing' | 'rotation' | 'incident';

export interface ChartAnnotationRecord {
  timestamp: string;
  date: string;
  label: string;
  type: AnnotationType;
  personaId?: string | null;
}

export function toChartDate(timestamp: string): string | null {
  const parsed = new Date(timestamp);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed.toISOString().slice(0, 10);
}
