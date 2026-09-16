/**
 * The contacts variant's person pieces: the 7-day activity SPARKLINE, the grid
 * TOKEN that carries it, and the alias/notes EDITOR.
 *
 * Extracted from `ContactsVariant` to keep that file under the repo's 200-line
 * component ceiling. The sparkline is derived from the feed's own message
 * entries by the caller — no contact tile issues a query of its own.
 */

import { useState } from 'react';
import { Pencil, User } from 'lucide-react';
import { AsyncButton, Button } from '@/features/shared/components/buttons';
import { RelativeTime } from '@/features/shared/components/display/RelativeTime';
import { RevealItem } from '@/features/shared/components/display/RevealItem';
import { FormField } from '@/features/shared/components/forms/FormField';
import { useTranslation } from '@/i18n/useTranslation';
import { INPUT_FIELD } from '@/lib/utils/designTokens';
import { toastCatch } from '@/lib/silentCatch';
import * as twinApi from '@/api/twin/twin';
import type { TwinContact } from '@/lib/bindings/TwinContact';
import type { HubRevealTracker } from '../HubEntryRow';

/** Daily bins, oldest first. Shape is owned by the caller's derivation. */
export type ContactBins = readonly number[];

export function ContactSparkline({ bins, label }: { bins: ContactBins; label: string }) {
  const max = bins.reduce((m, n) => (n > m ? n : m), 0);
  const barW = 3;
  const gap = 1;
  const h = 12;
  const w = bins.length * barW + (bins.length - 1) * gap;
  return (
    <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} role="img" aria-label={label}
      className="flex-shrink-0 text-primary">
      {bins.map((n, i) => {
        const bh = max === 0 ? 1 : Math.max(1, Math.round((n / max) * h));
        return (
          <rect key={i} x={i * (barW + gap)} y={h - bh} width={barW} height={bh} rx={1}
            fill="currentColor" opacity={n === 0 ? 0.18 : 0.85} />
        );
      })}
    </svg>
  );
}

export function ContactToken({ contact, bins, selected, order, enter, onSelect, sparkLabel }: {
  contact: TwinContact;
  bins: ContactBins;
  selected: boolean;
  order: number;
  enter: HubRevealTracker;
  onSelect: () => void;
  sparkLabel: string;
}) {
  const t = useTranslation().t.twin.hub.contacts;
  const display = contact.alias?.trim() ? contact.alias : contact.handle;
  return (
    <RevealItem as="li" revealId={contact.id} order={order} {...enter}>
      <button
        type="button"
        onClick={onSelect}
        aria-pressed={selected}
        className={`w-full h-full text-left rounded-card border px-3 py-2.5 transition-all focus-ring ${
          selected
            ? 'border-primary/50 bg-primary/10 shadow-elevation-1'
            : 'border-border bg-card/40 hover:border-primary/30 hover:bg-card/60'
        }`}
      >
        <span className="flex items-center gap-2 min-w-0">
          <span className="w-6 h-6 rounded-full bg-primary/10 border border-primary/30 flex items-center justify-center flex-shrink-0">
            <User className="w-3 h-3 text-primary" />
          </span>
          <span className="min-w-0 flex-1 typo-card-label text-foreground truncate">{display}</span>
          <ContactSparkline bins={bins} label={sparkLabel} />
        </span>
        <span className="mt-1.5 flex items-center gap-2 flex-wrap">
          <span className="typo-data tabular-nums text-primary">{Number(contact.message_count)}</span>
          <span className="typo-label text-foreground">{t.messagesLabel}</span>
          {contact.last_seen_at ? (
            <RelativeTime timestamp={contact.last_seen_at} className="ml-auto typo-caption text-foreground tabular-nums" />
          ) : (
            <span className="ml-auto typo-caption text-foreground">{t.neverSeen}</span>
          )}
        </span>
      </button>
    </RevealItem>
  );
}

/** Alias + notes, written through the existing `twin_update_contact` command. */
export function ContactEditor({ contact, onSaved }: {
  contact: TwinContact;
  onSaved: (updated: TwinContact) => void;
}) {
  const t = useTranslation().t.twin.hub.contacts;
  const [editing, setEditing] = useState(false);
  const [alias, setAlias] = useState(contact.alias ?? '');
  const [notes, setNotes] = useState(contact.notes ?? '');

  if (!editing) {
    return (
      <div className="flex items-start gap-2">
        {contact.notes && <p className="typo-caption text-foreground flex-1 min-w-0">{contact.notes}</p>}
        <Button size="xs" variant="ghost" className="ml-auto flex-shrink-0"
          onClick={() => { setAlias(contact.alias ?? ''); setNotes(contact.notes ?? ''); setEditing(true); }}>
          <Pencil className="w-3 h-3 mr-1" />
          {t.edit}
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-2 rounded-card border border-border bg-background/40 p-2.5">
      <FormField label={t.aliasLabel}>
        {(p) => <input {...p} type="text" value={alias} placeholder={t.aliasPlaceholder}
          onChange={(e) => setAlias(e.target.value)} className={INPUT_FIELD} />}
      </FormField>
      <FormField label={t.notesLabel}>
        {(p) => <textarea {...p} rows={2} value={notes} placeholder={t.notesPlaceholder}
          onChange={(e) => setNotes(e.target.value)} className={`${INPUT_FIELD} resize-y`} />}
      </FormField>
      <div className="flex justify-end gap-2">
        <Button size="xs" variant="ghost" onClick={() => setEditing(false)}>{t.cancel}</Button>
        <AsyncButton size="xs" variant="accent" accentColor="violet"
          // AsyncButton awaits but never catches — an unhandled rejection here
          // would be a silent failure, so the door is named on the promise.
          onClick={() => twinApi
            .updateTwinContact(contact.id, alias.trim() || undefined, notes.trim() || undefined)
            .then((updated) => { onSaved(updated); setEditing(false); })
            .catch(toastCatch('twin:hub:update-contact'))}
        >
          {t.save}
        </AsyncButton>
      </div>
    </div>
  );
}
