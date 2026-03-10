import { useEffect, useMemo, useState } from 'react';
import { usePersonaStore } from '@/stores/personaStore';
import { getPromptVersions } from '@/api/overview/observability';
import { getRotationHistory } from '@/api/vault/rotation';
import type { ChartAnnotationRecord } from './chartAnnotations';
import { toChartDate, useAnnotationComposer } from './chartAnnotations';
import type { PersonaHealingIssue } from '@/lib/bindings/PersonaHealingIssue';

const isDefined = <T,>(value: T | null | undefined): value is T => value != null;
const ANNOTATION_FETCH_DEBOUNCE_MS = 250;

interface AnnotationDataOptions {
  selectedPersonaId: string | null;
  healingIssues: PersonaHealingIssue[];
}

/** Loads and composes chart annotations from prompts, rotations, and healing issues. */
export function useAnnotationData({ selectedPersonaId, healingIssues }: AnnotationDataOptions) {
  const personas = usePersonaStore((s) => s.personas);
  const credentials = usePersonaStore((s) => s.credentials);

  const [promptAnnotations, setPromptAnnotations] = useState<ChartAnnotationRecord[]>([]);
  const [rotationAnnotations, setRotationAnnotations] = useState<ChartAnnotationRecord[]>([]);

  // Load prompt annotations
  useEffect(() => {
    const controller = new AbortController();
    const { signal } = controller;
    const timeoutId = setTimeout(() => {
      const loadPromptAnnotations = async () => {
        const personaIds = selectedPersonaId ? [selectedPersonaId] : personas.map((p) => p.id).slice(0, 8);
        if (personaIds.length === 0) {
          if (!signal.aborted) setPromptAnnotations([]);
          return;
        }
        try {
          const byPersona = await Promise.all(
            personaIds.map(async (personaId) => {
              if (signal.aborted) return [];
              const versions = await getPromptVersions(personaId, 8);
              if (signal.aborted) return [];
              return versions.map((version) => {
                const date = toChartDate(version.created_at);
                if (!date) return null;
                return {
                  timestamp: version.created_at, date,
                  label: `Prompt v${version.version_number} (${version.tag})`,
                  type: 'prompt' as const, personaId,
                };
              }).filter(isDefined);
            }),
          );
          if (!signal.aborted) setPromptAnnotations(byPersona.flat());
        } catch {
          if (!signal.aborted) setPromptAnnotations([]);
        }
      };
      void loadPromptAnnotations();
    }, ANNOTATION_FETCH_DEBOUNCE_MS);
    return () => { controller.abort(); clearTimeout(timeoutId); };
  }, [selectedPersonaId, personas]);

  // Load rotation annotations
  useEffect(() => {
    const controller = new AbortController();
    const { signal } = controller;
    const timeoutId = setTimeout(() => {
      const loadRotationAnnotations = async () => {
        if (credentials.length === 0) {
          if (!signal.aborted) setRotationAnnotations([]);
          return;
        }
        try {
          const byCredential = await Promise.all(
            credentials.slice(0, 20).map(async (credential) => {
              if (signal.aborted) return [];
              const history = await getRotationHistory(credential.id, 3);
              if (signal.aborted) return [];
              return history.map((entry) => {
                const date = toChartDate(entry.created_at);
                if (!date) return null;
                return {
                  timestamp: entry.created_at, date,
                  label: `Rotation ${entry.status}${credential.name ? ` · ${credential.name}` : ''}`,
                  type: 'rotation' as const, personaId: null,
                };
              }).filter(isDefined);
            }),
          );
          if (!signal.aborted) setRotationAnnotations(byCredential.flat());
        } catch {
          if (!signal.aborted) setRotationAnnotations([]);
        }
      };
      void loadRotationAnnotations();
    }, ANNOTATION_FETCH_DEBOUNCE_MS);
    return () => { controller.abort(); clearTimeout(timeoutId); };
  }, [credentials]);

  // Healing issue annotations
  const healingAnnotations = useMemo<ChartAnnotationRecord[]>(() =>
    healingIssues
      .map((issue) => {
        const date = toChartDate(issue.created_at);
        if (!date) return null;
        return {
          timestamp: issue.created_at, date,
          label: issue.is_circuit_breaker ? `Circuit breaker: ${issue.title}` : issue.title,
          type: issue.is_circuit_breaker ? 'incident' as const : 'healing' as const,
          personaId: issue.persona_id,
        };
      })
      .filter(isDefined),
  [healingIssues]);

  const chartAnnotations = useAnnotationComposer(
    [promptAnnotations, rotationAnnotations, healingAnnotations],
    { filterPersonaId: selectedPersonaId },
  );

  return chartAnnotations;
}
