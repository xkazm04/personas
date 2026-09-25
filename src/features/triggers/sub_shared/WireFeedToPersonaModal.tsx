/**
 * Wire a watched Marketplace feed straight to a persona.
 *
 * Watching a feed only flips a subscription row. Chain Studio already knew how
 * to turn the same feed into work — its marketplace branch commits an
 * `event_listener` on `shared:<slug>` — but that wire could only be drawn over
 * in the Studio, so the surface where the operator is actually looking at feeds
 * could not create it.
 *
 * The payload is not re-derived here: it comes from
 * `draftLinkToTriggerInput`'s marketplace branch via a synthetic link, so the
 * two doors cannot drift into producing different triggers for the same feed.
 */
import { useMemo, useState } from 'react';
import { Radio } from 'lucide-react';
import { BaseModal } from '@/lib/ui/BaseModal';
import { Button } from '@/features/shared/components/buttons';
import AsyncButton from '@/features/shared/components/buttons/AsyncButton';
import { useAgentStore } from '@/stores/agentStore';
import { useToastStore } from '@/stores/toastStore';
import { useTranslation } from '@/i18n/useTranslation';
import { silentCatch } from '@/lib/silentCatch';
import { createTrigger } from '@/api/pipeline/triggers';
import { draftLinkToTriggerInput } from '@/features/triggers/sub_studio/libs/studioCommit';
import type { SharedEventCatalogEntry } from '@/lib/bindings/SharedEventCatalogEntry';

export interface WireFeedToPersonaModalProps {
  entry: SharedEventCatalogEntry;
  onClose: () => void;
}

/** The `create_trigger` input for "this feed drives that persona", borrowed
 *  whole from the Studio's marketplace commit so there is exactly one
 *  definition of the shape. Returns null only if that branch ever stops
 *  handling a marketplace source. */
export function feedListenerInput(slug: string, label: string, personaId: string) {
  return draftLinkToTriggerInput({
    id: 'wire-from-watchtower',
    source: { kind: 'marketplace', slug, label },
    targetPersonaId: personaId,
    condition: null,
  });
}

export function WireFeedToPersonaModal({ entry, onClose }: WireFeedToPersonaModalProps) {
  const { t, tx } = useTranslation();
  const m = t.triggers.marketplace;
  const personas = useAgentStore((s) => s.personas);
  const addToast = useToastStore((s) => s.addToast);
  const [selected, setSelected] = useState<string | null>(null);

  const sorted = useMemo(
    () => [...personas].sort((a, b) => a.name.localeCompare(b.name)),
    [personas],
  );

  const wire = async () => {
    const target = sorted.find((p) => p.id === selected);
    if (!target) return;
    const input = feedListenerInput(entry.slug, entry.name, target.id);
    if (!input) return;
    try {
      await createTrigger(input);
      addToast(tx(m.wire_created, { persona: target.name }), 'success');
      onClose();
    } catch (err) {
      silentCatch('features/triggers/sub_shared/WireFeedToPersonaModal:wire')(err);
      addToast(m.wire_failed, 'error');
    }
  };

  return (
    <BaseModal isOpen onClose={onClose} titleId="wire-feed-title" size="sm" portal>
      <div className="flex flex-col max-h-[70vh]" data-testid="wire-feed-modal">
        <div className="flex items-center gap-2 px-4 py-3 border-b border-card-border/60 shrink-0">
          <Radio className="w-4 h-4 text-primary shrink-0" aria-hidden />
          <h2 id="wire-feed-title" className="typo-label text-foreground truncate">
            {m.wire_title} — {entry.name}
          </h2>
        </div>

        <div className="flex-1 min-h-0 overflow-y-auto scrollbar-thin px-4 py-3">
          <p className="typo-caption text-foreground/90 mb-2">{m.wire_hint}</p>
          {sorted.length === 0 ? (
            <p className="py-4 typo-caption text-foreground/90 text-center">{m.wire_empty}</p>
          ) : (
            <ul className="space-y-1" role="radiogroup" aria-label={m.wire_title}>
              {sorted.map((p) => (
                <li key={p.id}>
                  <button
                    type="button"
                    role="radio"
                    aria-checked={selected === p.id}
                    onClick={() => setSelected(p.id)}
                    className={`w-full text-left px-2.5 py-1.5 rounded-interactive typo-caption transition-colors ${
                      selected === p.id
                        ? 'bg-primary/15 text-primary border border-primary/35'
                        : 'bg-secondary/40 text-foreground border border-card-border hover:border-foreground/30'
                    }`}
                  >
                    {p.name}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="flex items-center justify-end gap-2 px-4 py-3 border-t border-card-border/60 shrink-0">
          <Button variant="ghost" size="sm" onClick={onClose}>{t.common.cancel}</Button>
          <AsyncButton size="sm" variant="primary" onClick={wire} disabled={!selected}>
            {m.wire_confirm}
          </AsyncButton>
        </div>
      </div>
    </BaseModal>
  );
}
