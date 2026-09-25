/** CoreLayer - the persona core as a layer of the sheet. The compose centre's
 *  core badge pushes the camera in exactly like a frame does (the layer grows
 *  out of the badge) and the configurator gets the whole stage: the three Codex
 *  columns side by side at full height, which a modal inside the centre cell
 *  could never give them. The layer's header names the archetype picked, a
 *  hand-built core, or that the build will infer it. Closing (Done, Esc, back)
 *  records the selection through the same analytics the modal fires; the
 *  layout does that on every close route, so this file only lays out. */
import { useTranslation } from "@/i18n/useTranslation";
import { PersonaCoreBody, personaCoreAccent, type PersonaCore } from "@/features/agents/sub_glyph/personaCore";
import type { LoupeHead } from "./LoupeHeader";
import { COPY } from "./copy";

/** The core sits in the centre frame, so it carries the centre's edge number. */
const CENTRE_CODE = "00";

/** Header and ring colour for the core layer. */
export function useCoreHead(core: PersonaCore, scene: string): { head: LoupeHead; color: string } {
  const { t } = useTranslation();
  // `preset.name` is the archetype's own catalog name, deliberately untranslated
  // (the badge shows it the same way).
  const status = core.preset
    ? { label: core.preset.name, strong: true }
    : { label: core.configured ? t.agents.core_custom : COPY.core.inferred, strong: core.configured };
  return {
    head: { code: CENTRE_CODE, title: t.agents.core_title, status, context: scene },
    color: personaCoreAccent(core),
  };
}

interface CoreLayerProps {
  core: PersonaCore;
  /** User close: the layout records the selection and pulls out. */
  onDone: () => void;
  /** Crash recovery: pull out without recording a selection never seen. */
  onCrashReset: () => void;
}

export function CoreLayer({ core, onDone, onCrashReset }: CoreLayerProps) {
  return (
    <div className="flex-1 min-h-0 flex flex-col gap-4 w-full max-w-[1480px] mx-auto" data-testid="persona-core-layer">
      <p className="typo-body-lg text-foreground">{COPY.core.hint}</p>
      <PersonaCoreBody core={core} onDone={onDone} onCrashReset={onCrashReset} fill />
    </div>
  );
}
