/** PersonaCoreModal — the persona-core configurator as a modal.
 *
 *  Rethought (2026-07-08) against the real corpus: model tier × reasoning effort,
 *  a conflict style + a clickable character-trait palette.
 *  Memory is NOT here — the build surface's memory dimension owns it. The layout
 *  is the "Codex" design (won the /prototype round): an ordered, icon-forward
 *  3-column grid — Mentality · Character · Configuration. The content lives in
 *  PersonaCoreBody, which the Sheet · Cinema loupe layer hosts as well.
 */
import { useCallback } from "react";
import { BaseModal } from "@/features/shared/components/modals";
import { useTranslation } from "@/i18n/useTranslation";
import { PersonaCoreBody } from "./PersonaCoreBody";
import { recordPersonaCoreClose } from "./coreAnalytics";
import type { PersonaCore } from "./types";

export function PersonaCoreModal({ core, isOpen, onClose }: { core: PersonaCore; isOpen: boolean; onClose: () => void }) {
  const { t } = useTranslation();

  // Fires on every exit route (Done, Esc, backdrop); see coreAnalytics.
  const handleClose = useCallback(() => {
    recordPersonaCoreClose(core);
    onClose();
  }, [core, onClose]);

  return (
    <BaseModal isOpen={isOpen} onClose={handleClose} titleId="persona-core-modal" size="6xl" maxWidthClass="max-w-[86rem]">
      <div className="flex flex-col gap-4 p-5" data-testid="persona-core-modal">
        <div className="flex flex-col gap-0.5">
          <h2 id="persona-core-modal" className="typo-heading-lg text-foreground">{t.agents.core_title}</h2>
          <span className="typo-caption">{t.agents.core_subtitle}</span>
        </div>
        {/* Crash reset is the RAW onClose: a boundary reset is crash recovery,
            not a user closing the modal. */}
        <PersonaCoreBody core={core} onDone={handleClose} onCrashReset={onClose} />
      </div>
    </BaseModal>
  );
}
