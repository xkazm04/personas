import { useEffect, useRef } from 'react';
import { Sparkles } from 'lucide-react';
import { useAgentStore } from '@/stores/agentStore';
import { useSystemStore } from '@/stores/systemStore';
import { useParsedDesignContext } from '@/stores/selectors/personaSelectors';
import { parseDesignContext, serializeDesignContext } from '@/features/shared/components/use-cases/UseCasesList';
import { INPUT_FIELD } from '@/lib/utils/designTokens';

/**
 * Twin binding selector for the Persona settings tab.
 *
 * Lets the user pin this persona to a specific Twin profile (or inherit
 * the globally-active twin). Persists into `design_context.twinId` via
 * the existing `UpdateDesignContext` op — no new IPC, no schema change.
 *
 * Connector resolution (the runtime side that actually reads twinId
 * before falling back to the active twin) is a follow-up — see
 * `src-tauri/src/commands/infrastructure/twin.rs::twin_get_active_profile`.
 */
export function TwinBindingCard() {
  const selectedPersona = useAgentStore((s) => s.selectedPersona);
  const applyPersonaOp = useAgentStore((s) => s.applyPersonaOp);
  const designContext = useParsedDesignContext();

  const twinProfiles = useSystemStore((s) => s.twinProfiles);
  const activeTwinId = useSystemStore((s) => s.activeTwinId);
  const fetchTwinProfiles = useSystemStore((s) => s.fetchTwinProfiles);
  const loadedRef = useRef(false);

  useEffect(() => {
    if (!loadedRef.current && twinProfiles.length === 0) {
      loadedRef.current = true;
      void fetchTwinProfiles();
    }
  }, [twinProfiles.length, fetchTwinProfiles]);

  if (!selectedPersona) return null;

  const currentTwinId = designContext.twinId ?? '';
  const inheritsActive = !currentTwinId;
  const activeTwin = activeTwinId ? twinProfiles.find((tw) => tw.id === activeTwinId) : null;

  const handleChange = async (value: string) => {
    // Merge twinId into the existing design_context envelope. Empty string
    // means "inherit active twin" — store it as undefined so the field
    // drops out of the JSON entirely (smaller payload, easier diff).
    const next = parseDesignContext(selectedPersona.design_context);
    if (value) next.twinId = value;
    else delete next.twinId;
    await applyPersonaOp(selectedPersona.id, {
      kind: 'UpdateDesignContext',
      design_context: serializeDesignContext(next),
    });
  };

  return (
    <div className="space-y-3">
      <h4 className="flex items-center gap-2.5 typo-heading font-semibold text-foreground/90 tracking-wide">
        <span className="w-6 h-[2px] bg-gradient-to-r from-primary to-accent rounded-full" />
        Twin
      </h4>
      <div className="bg-secondary/40 backdrop-blur-sm border border-primary/20 rounded-modal p-3 space-y-3">
        <div>
          <label className="block typo-body font-medium text-foreground mb-1">
            Speak as
          </label>
          {twinProfiles.length === 0 ? (
            <p className="typo-caption text-foreground">
              No twins configured. Open the Twin plugin to create one — this persona will then be able to adopt it.
            </p>
          ) : (
            <>
              <div className="relative">
                <Sparkles className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-violet-400/60 pointer-events-none" />
                <select
                  value={currentTwinId}
                  onChange={(e) => void handleChange(e.target.value)}
                  className={`${INPUT_FIELD} pl-9 cursor-pointer`}
                  aria-label="Twin profile this persona speaks as"
                >
                  <option value="">
                    {activeTwin
                      ? `Inherit active twin (${activeTwin.name})`
                      : 'Inherit active twin'}
                  </option>
                  {twinProfiles.map((tw) => (
                    <option key={tw.id} value={tw.id}>
                      {tw.name}{tw.role ? ` — ${tw.role}` : ''}
                    </option>
                  ))}
                </select>
              </div>
              <p className="typo-caption text-foreground mt-1.5">
                {inheritsActive
                  ? 'When this persona invokes a twin tool, it adopts whichever twin is currently active in the Twin plugin.'
                  : 'This persona always adopts the selected twin, regardless of which twin is globally active.'}
              </p>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
