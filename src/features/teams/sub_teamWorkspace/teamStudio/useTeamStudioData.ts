import { useCallback, useMemo, useState } from 'react';
import { useAgentStore } from '@/stores/agentStore';
import { usePipelineStore } from '@/stores/pipelineStore';
import { setUseCaseEnabled } from '@/api/agents/useCases';
import { silentCatch } from '@/lib/silentCatch';
import type { Persona } from '@/lib/bindings/Persona';
import type { PersonaTeamMember } from '@/lib/bindings/PersonaTeamMember';

/**
 * Shared data layer for the Team Studio variants (Grid + Split).
 *
 * Resolves the selected team's members into a display-ready model:
 * each member's persona, its parsed use-cases (with the runtime
 * `enabled` flag), a short model-tier label, trust score, and the
 * preset semantic role (stored in `member.config`). Also owns the
 * use-case toggle action so both variants share one optimistic path.
 *
 * This is the extractable core both variants import — keeps the
 * member→persona→use-case derivation in one place rather than
 * duplicated per layout.
 */

export interface StudioUseCase {
  id: string;
  title: string;
  description: string;
  category: string | null;
  /** `undefined`/`true` = active (Phase C1 runtime toggle). */
  enabled: boolean;
  capabilitySummary: string | null;
}

export interface StudioMember {
  memberId: string;
  personaId: string;
  persona: Persona | null;
  name: string;
  icon: string | null;
  color: string | null;
  /** Short model label: "Opus" | "Sonnet" | "Haiku" | "Inherit". */
  modelTier: string;
  trustScore: number;
  /** Semantic preset role from member.config ({"preset_role":"…"}). */
  presetRole: string | null;
  useCases: StudioUseCase[];
  activeUseCaseCount: number;
}

interface DesignContextShape {
  useCases?: Array<{
    id?: string;
    title?: string;
    description?: string;
    category?: string;
    enabled?: boolean;
    capability_summary?: string;
  }>;
}

function parseModelTier(modelProfile: string | null): string {
  if (!modelProfile) return 'Inherit';
  let model = modelProfile;
  try {
    const parsed = JSON.parse(modelProfile) as { model?: string };
    if (parsed && typeof parsed.model === 'string') model = parsed.model;
  } catch (err) {
    /* model_profile may be a bare string */
    silentCatch('teamStudio/useTeamStudioData:parseModelTier')(err);
  }
  const m = model.toLowerCase();
  if (m.includes('opus')) return 'Opus';
  if (m.includes('sonnet')) return 'Sonnet';
  if (m.includes('haiku')) return 'Haiku';
  return 'Inherit';
}

function presetRoleOf(config: string | null): string | null {
  if (!config) return null;
  try {
    return (JSON.parse(config) as { preset_role?: string }).preset_role ?? null;
  } catch {
    return null;
  }
}

function parseUseCases(persona: Persona | null): StudioUseCase[] {
  if (!persona?.design_context) return [];
  let ctx: DesignContextShape;
  try {
    ctx = JSON.parse(persona.design_context) as DesignContextShape;
  } catch {
    return [];
  }
  const list = ctx.useCases ?? [];
  return list
    .filter((uc): uc is Required<Pick<NonNullable<typeof list>[number], 'id'>> & typeof uc =>
      typeof uc.id === 'string',
    )
    .map((uc) => ({
      id: uc.id as string,
      title: uc.title ?? (uc.id as string),
      description: uc.description ?? '',
      category: uc.category ?? null,
      enabled: uc.enabled !== false,
      capabilitySummary: uc.capability_summary ?? null,
    }));
}

export function useTeamStudioData() {
  const teamMembers = usePipelineStore((s) => s.teamMembers) as PersonaTeamMember[];
  const personas = useAgentStore((s) => s.personas);
  const fetchPersonas = useAgentStore((s) => s.fetchPersonas);

  const members = useMemo<StudioMember[]>(() => {
    const byId = new Map(personas.map((p) => [p.id, p]));
    return teamMembers.map((m) => {
      const persona = byId.get(m.persona_id) ?? null;
      const useCases = parseUseCases(persona);
      return {
        memberId: m.id,
        personaId: m.persona_id,
        persona,
        name: persona?.name ?? m.persona_id,
        icon: persona?.icon ?? null,
        color: persona?.color ?? null,
        modelTier: parseModelTier(persona?.model_profile ?? null),
        trustScore: persona?.trust_score ?? 0,
        presetRole: presetRoleOf(m.config),
        useCases,
        activeUseCaseCount: useCases.filter((u) => u.enabled).length,
      };
    });
  }, [teamMembers, personas]);

  const [busyUseCases, setBusyUseCases] = useState<ReadonlySet<string>>(new Set());

  const toggleUseCase = useCallback(
    async (personaId: string, useCaseId: string, enabled: boolean) => {
      const key = `${personaId}:${useCaseId}`;
      setBusyUseCases((prev) => new Set(prev).add(key));
      try {
        await setUseCaseEnabled(personaId, useCaseId, enabled);
        await fetchPersonas?.();
      } catch (err) {
        silentCatch('teamStudio/useTeamStudioData:toggleUseCase')(err);
      } finally {
        setBusyUseCases((prev) => {
          const next = new Set(prev);
          next.delete(key);
          return next;
        });
      }
    },
    [fetchPersonas],
  );

  return { members, toggleUseCase, busyUseCases };
}
