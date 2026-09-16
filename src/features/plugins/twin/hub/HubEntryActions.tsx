/**
 * The react affordances every Hub variant offers on a row, plus the ONE
 * kind/status presentation table the variants read.
 *
 * A kind is carried by GLYPH + semantic colour role, never by a long label —
 * the token drives both, and no call site reaches past the role.
 */

import { useState } from 'react';
import {
  BookHeart, Check, Library, MessageSquare, ShieldCheck, Sparkles, Trash2, Wand2, X,
  type LucideIcon,
} from 'lucide-react';
import { AsyncButton } from '@/features/shared/components/buttons';
import { Tooltip } from '@/features/shared/components/display/Tooltip';
import { useTranslation } from '@/i18n/useTranslation';
import { HUB_REJECT_REASONS, type HubEntry, type HubEntryKind, type HubFeedApi, type HubRejectReason, type HubReviewStatus } from './hubContract';

interface RoleClasses { Icon: LucideIcon; text: string; bg: string; border: string }

/** kind → glyph + semantic role. Five kinds, five distinguishable roles. */
export const HUB_KIND_META: Record<HubEntryKind, RoleClasses> = {
  memory: { Icon: Sparkles, text: 'text-primary', bg: 'bg-primary/10', border: 'border-primary/30' },
  message: { Icon: MessageSquare, text: 'text-status-info', bg: 'bg-status-info/10', border: 'border-status-info/30' },
  fact: { Icon: Library, text: 'text-status-success', bg: 'bg-status-success/10', border: 'border-status-success/30' },
  reflection: { Icon: BookHeart, text: 'text-status-neutral', bg: 'bg-status-neutral/10', border: 'border-status-neutral/30' },
  audit: { Icon: ShieldCheck, text: 'text-status-warning', bg: 'bg-status-warning/10', border: 'border-status-warning/30' },
};

/** review status → glyph + semantic role. */
export const HUB_STATUS_META: Record<HubReviewStatus, RoleClasses> = {
  pending: { Icon: Wand2, text: 'text-status-pending', bg: 'bg-status-pending/10', border: 'border-status-pending/30' },
  approved: { Icon: Check, text: 'text-status-success', bg: 'bg-status-success/10', border: 'border-status-success/30' },
  rejected: { Icon: X, text: 'text-status-error', bg: 'bg-status-error/10', border: 'border-status-error/30' },
};

/** A memory or an audit report is reviewable; nothing else carries a verdict. */
export function isReviewable(entry: HubEntry): boolean {
  return entry.status === 'pending' && (entry.kind === 'memory' || entry.kind === 'audit');
}

/** The ONE reject-reason table, rendered as chips. Presets live in the contract. */
export function HubRejectChips({ onPick, onCancel, showKeys = false }: {
  onPick: (reason: HubRejectReason) => void;
  onCancel: () => void;
  /** Desk mode: each chip advertises the digit that files it. */
  showKeys?: boolean;
}) {
  const t = useTranslation().t.twin.hub;
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <span className="typo-label text-status-error">{t.entry.rejectHeading}</span>
      {HUB_REJECT_REASONS.map((reason, i) => (
        <button
          key={reason}
          type="button"
          onClick={() => onPick(reason)}
          className="px-2 py-0.5 rounded-full border border-status-error/30 bg-status-error/10 text-status-error typo-caption transition-colors hover:bg-status-error/20 focus-ring"
        >
          {showKeys ? `${i + 1} · ${t.reasons[reason]}` : t.reasons[reason]}
        </button>
      ))}
      <button
        type="button"
        onClick={onCancel}
        className="px-2 py-0.5 rounded-full border border-border typo-caption text-foreground transition-colors hover:bg-secondary/50 focus-ring"
      >
        {t.entry.rejectCancel}
      </button>
    </div>
  );
}

/**
 * Inline affordances for one row. Every control is an `AsyncButton`, so the
 * spinner belongs to the control the user pressed — and `busyId` keeps a
 * sibling row's controls quiet while this one works.
 */
export function HubEntryActions({ entry, feed }: { entry: HubEntry; feed: HubFeedApi }) {
  const t = useTranslation().t.twin.hub;
  const [rejecting, setRejecting] = useState(false);
  const busy = feed.busyId === entry.id;
  const otherBusy = feed.busyId !== null && !busy;

  if (rejecting) {
    return (
      <HubRejectChips
        onPick={(reason) => { setRejecting(false); void feed.reject(entry, reason); }}
        onCancel={() => setRejecting(false)}
      />
    );
  }

  const canSaveFact = entry.kind === 'message'
    || (entry.source.kind === 'memory' && !!entry.source.row.source_communication_id);

  return (
    <div className="flex items-center gap-1">
      {isReviewable(entry) && (
        <>
          <Icon label={t.entry.approve}>
            <AsyncButton size="icon-sm" variant="accent" accentColor="emerald" isLoading={busy}
              disabled={otherBusy} aria-label={t.entry.approve}
              onClick={() => feed.approve(entry)} icon={<Check className="w-3.5 h-3.5" />} />
          </Icon>
          <Icon label={t.entry.digDeeper}>
            <AsyncButton size="icon-sm" variant="accent" accentColor="violet" isLoading={busy}
              disabled={otherBusy} aria-label={t.entry.digDeeper}
              onClick={() => feed.digDeeper(entry)} icon={<Wand2 className="w-3.5 h-3.5" />} />
          </Icon>
          <Icon label={t.entry.reject}>
            <AsyncButton size="icon-sm" variant="accent" accentColor="rose" disabled={otherBusy || busy}
              aria-label={t.entry.reject} onClick={() => { setRejecting(true); }}
              icon={<X className="w-3.5 h-3.5" />} />
          </Icon>
        </>
      )}

      {canSaveFact && (
        <Icon label={t.entry.saveAsFact}>
          <AsyncButton size="icon-sm" variant="ghost" isLoading={busy} disabled={otherBusy}
            aria-label={t.entry.saveAsFact} onClick={() => feed.saveAsFact(entry, 3)}
            icon={<Library className="w-3.5 h-3.5" />} />
        </Icon>
      )}

      {entry.kind === 'fact' && (
        <Icon label={t.entry.deleteFact}>
          <AsyncButton size="icon-sm" variant="ghost" isLoading={busy} disabled={otherBusy}
            aria-label={t.entry.deleteFact} onClick={() => feed.deleteFact(entry)}
            icon={<Trash2 className="w-3.5 h-3.5" />} />
        </Icon>
      )}

      {entry.kind === 'reflection' && (
        <Icon label={t.entry.deleteReflection}>
          <AsyncButton size="icon-sm" variant="ghost" isLoading={busy} disabled={otherBusy}
            aria-label={t.entry.deleteReflection} onClick={() => feed.deleteReflection(entry)}
            icon={<Trash2 className="w-3.5 h-3.5" />} />
        </Icon>
      )}
    </div>
  );
}

function Icon({ label, children }: { label: string; children: React.ReactNode }) {
  return <Tooltip content={label}>{children}</Tooltip>;
}
