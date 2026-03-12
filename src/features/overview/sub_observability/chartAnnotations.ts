import { useMemo } from 'react';

// -- Annotation Types -------------------------------------------------

/** Built-in annotation types. Consumers can pass any string via the union escape hatch. */
export type AnnotationType = 'prompt' | 'healing' | 'rotation' | 'incident' | 'budget' | 'deployment' | 'config' | (string & {});

export interface ChartAnnotationRecord {
  timestamp: string;
  date: string;
  label: string;
  type: AnnotationType;
  /** Optional per-record color override. Falls back to type default. */
  color?: string;
  personaId?: string | null;
}

// -- Color Defaults ---------------------------------------------------

const ANNOTATION_TYPE_COLORS: Record<string, string> = {
  prompt: '#8b5cf6',
  rotation: '#f59e0b',
  incident: '#ef4444',
  healing: '#06b6d4',
  budget: '#f97316',
  deployment: '#22c55e',
  config: '#a78bfa',
};

const DEFAULT_COLOR = '#818cf8';

/** Resolve the display color for an annotation (per-record override > type default > fallback). */
export function getAnnotationColor(type: string, colorOverride?: string): string {
  return colorOverride ?? ANNOTATION_TYPE_COLORS[type] ?? DEFAULT_COLOR;
}

// -- Date helper ------------------------------------------------------

export function toChartDate(timestamp: string): string | null {
  const parsed = new Date(timestamp);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed.toISOString().slice(0, 10);
}

// -- Annotation Composer Hook -----------------------------------------

export interface AnnotationComposerOptions {
  /** When set, only annotations with no personaId or matching personaId are kept. */
  filterPersonaId?: string | null;
  /** Max annotations to return (most recent kept). Default 24. */
  maxAnnotations?: number;
}

/**
 * Composable hook that merges multiple annotation sources, deduplicates,
 * filters by persona, and caps output. Any dashboard can feed in any
 * number of timestamped marker arrays.
 */
export function useAnnotationComposer(
  sources: ChartAnnotationRecord[][],
  options: AnnotationComposerOptions = {},
): ChartAnnotationRecord[] {
  const { filterPersonaId, maxAnnotations = 24 } = options;

  return useMemo(() => {
    // 1. Merge all sources
    let merged: ChartAnnotationRecord[] = [];
    for (const source of sources) {
      for (const entry of source) {
        merged.push(entry);
      }
    }

    // 2. Filter by persona
    if (filterPersonaId) {
      merged = merged.filter(
        (entry) => !entry.personaId || entry.personaId === filterPersonaId,
      );
    }

    // 3. Sort chronologically
    merged.sort((a, b) => a.timestamp.localeCompare(b.timestamp));

    // 4. Deduplicate (same date + type + label = same annotation)
    const deduped = new Map<string, ChartAnnotationRecord>();
    for (const entry of merged) {
      const key = `${entry.date}:${entry.type}:${entry.label}`;
      if (!deduped.has(key)) deduped.set(key, entry);
    }

    // 5. Cap to most recent N annotations
    const values = [...deduped.values()];
    return values.length > maxAnnotations
      ? values.slice(values.length - maxAnnotations)
      : values;
  }, [sources, filterPersonaId, maxAnnotations]);
}
