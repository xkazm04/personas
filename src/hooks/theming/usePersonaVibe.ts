import { useMemo } from 'react';
import { useAgentStore } from "@/stores/agentStore";
import { deriveVibe, VIBE_THEMES, type VibeId, type VibeTheme } from '@/lib/theming/vibeThemes';

/**
 * Returns the active vibe theme derived from the currently selected persona.
 * When no persona is selected, returns the 'default' vibe (no overlay).
 */
export function usePersonaVibe(): { vibeId: VibeId; vibe: VibeTheme } {
  const selectedPersona = useAgentStore((s) => s.selectedPersona);

  const vibeId = useMemo(() => {
    if (!selectedPersona) return 'default';
    return deriveVibe(
      selectedPersona.name,
      selectedPersona.description,
      selectedPersona.system_prompt,
    );
  }, [selectedPersona]);

  return { vibeId, vibe: VIBE_THEMES[vibeId] };
}
