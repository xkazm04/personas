import { useEffect, useMemo, useState } from 'react';
import { useAgentStore } from "@/stores/agentStore";
import { useVaultStore } from "@/stores/vaultStore";
import { getPromptVersionsBulk } from '@/api/overview/observability';
import { getRotationHistoryBulk } from '@/api/vault/rotation';
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
  const personas = useAgentStore((s) => s.personas);
  const credentials = useVaultStore((s) => s.credentials);

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
          // One bulk IPC instead of one per persona (architect perf scan, Phase D).
          const byPersona = await getPromptVersionsBulk(personaIds, 8);
          if (signal.aborted) return;
          const annotations: ChartAnnotationRecord[] = [];
          for (const [personaId, versions] of Object.entries(byPersona)) {
            for (const version of versions) {
              const date = toChartDate(version.created_at);
              if (!date) continue;
              annotations.push({
                timestamp: version.created_at, date,
                label: `Prompt v${version.version_number} (${version.tag})`,
                type: 'prompt' as const, personaId,
              });
            }
          }
          setPromptAnnotations(annotations);
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
        const creds = credentials.slice(0, 20);
        if (creds.length === 0) {
          if (!signal.aborted) setRotationAnnotations([]);
          return;
        }
        try {
          // One bulk IPC instead of one per credential (architect perf scan, Phase D).
          const byCredential = await getRotationHistoryBulk(creds.map((c) => c.id), 3);
          if (signal.aborted) return;
          const annotations: ChartAnnotationRecord[] = [];
          for (const credential of creds) {
            const history = byCredential[credential.id] ?? [];
            for (const entry of history) {
              const date = toChartDate(entry.created_at);
              if (!date) continue;
              annotations.push({
                timestamp: entry.created_at, date,
                label: `Rotation ${entry.status}${credential.name ? ` · ${credential.name}` : ''}`,
                type: 'rotation' as const, personaId: null,
              });
            }
          }
          setRotationAnnotations(annotations);
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
