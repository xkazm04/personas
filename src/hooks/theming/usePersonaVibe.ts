import { useMemo } from 'react';
import { useAgentStore } from "@/stores/agentStore";
import { deriveVibe, VIBE_THEMES, type VibeId, type VibeTheme } from '@/lib/theming/vibeThemes';

const warnedMissingVibes = new Set<string>();

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

  const vibe = VIBE_THEMES[vibeId];
  if (!vibe) {
    if (!warnedMissingVibes.has(vibeId)) {
      warnedMissingVibes.add(vibeId);
      console.warn(`[usePersonaVibe] Unknown vibeId "${vibeId}" — falling back to 'default'.`);
    }
    return { vibeId: 'default', vibe: VIBE_THEMES.default };
  }

  return { vibeId, vibe };
}
