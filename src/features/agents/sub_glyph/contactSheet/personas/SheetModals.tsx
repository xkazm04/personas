/** SheetModals - the heavier layers the sheet keeps out of sight: the refine
 *  composer and the raw build log. Both sit on the shared BaseModal. */
import { useState } from "react";
import { RefreshCw } from "lucide-react";
import { BaseModal } from "@/features/shared/components/modals";
import Button from "@/features/shared/components/buttons/Button";
import { useTranslation } from "@/i18n/useTranslation";
import { CARD_PADDING } from "@/lib/utils/designTokens";
import { COPY } from "./copy";

export function RefineModal({ open, onClose, onSubmit }: { open: boolean; onClose: () => void; onSubmit: (v: string) => void }) {
  const { t } = useTranslation();
  const [text, setText] = useState("");
  const submit = () => {
    const v = text.trim();
    if (!v) return;
    onSubmit(v);
    setText("");
    onClose();
  };
  return (
    <BaseModal isOpen={open} onClose={onClose} titleId="cs-personas-refine" size="md">
      <div className={`flex flex-col gap-3 ${CARD_PADDING.modalSection}`}>
        <h2 id="cs-personas-refine" className="typo-heading-lg text-foreground">{COPY.refineTitle}</h2>
        <textarea
          autoFocus
          rows={5}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) { e.preventDefault(); submit(); } }}
          className="w-full resize-none rounded-input border border-card-border bg-background/50 px-3 py-2 typo-body text-foreground focus-ring"
        />
        <div className="flex justify-end gap-2">
          <Button variant="ghost" size="md" onClick={onClose}>{t.common.cancel}</Button>
          <Button variant="primary" size="md" icon={<RefreshCw className="w-4 h-4" />} onClick={submit} disabled={!text.trim()}>
            {t.agents.glyph_refine}
          </Button>
        </div>
      </div>
    </BaseModal>
  );
}

export function LogModal({ open, onClose, lines }: { open: boolean; onClose: () => void; lines: string[] }) {
  const { t } = useTranslation();
  return (
    <BaseModal isOpen={open} onClose={onClose} titleId="cs-personas-log" size="lg">
      <div className={`flex flex-col gap-3 ${CARD_PADDING.modalSection}`}>
        <h2 id="cs-personas-log" className="typo-heading-lg text-foreground">{COPY.cliLog}</h2>
        <div className="max-h-[60vh] overflow-y-auto rounded-input border border-card-border bg-secondary/40 px-3.5 py-3">
          {lines.length === 0 ? (
            <span className="typo-caption">{COPY.cliLogEmpty}</span>
          ) : lines.map((l, i) => (
            <div key={i} className="typo-code text-foreground whitespace-pre-wrap break-words">{l}</div>
          ))}
        </div>
        <div className="flex justify-end">
          <Button variant="secondary" size="md" onClick={onClose}>{t.common.close}</Button>
        </div>
      </div>
    </BaseModal>
  );
}
