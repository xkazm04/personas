import { Copy, Check, Cloud, Unplug, AlertCircle, Clock, Hash, FolderOpen } from 'lucide-react';
import { AbsoluteTime } from '@/features/shared/components/display/AbsoluteTime';
import { useCopyToClipboard } from '@/hooks/utility/interaction/useCopyToClipboard';
import { UuidLabel } from '@/features/shared/components/display/UuidLabel';
import { BaseModal } from '@/lib/ui/BaseModal';
import { X } from 'lucide-react';
import { HighlightedJson } from './HighlightedJson';
import { formatRelativeTime } from '@/lib/utils/formatters';
import { EventStatusMark } from './EventStatusMark';
import type { PersonaEvent } from '@/lib/types/types';
import { useTranslation } from '@/i18n/useTranslation';
import { EventReasonNote } from '../lib/EventReasonView';
import { classifyEventReason } from '../lib/eventReason';

interface EventDetailModalProps {
  event: PersonaEvent;
  onClose: () => void;
}

const SOURCE_ICONS: Record<string, { icon: typeof Cloud; color: string }> = {
  cloud_webhook: { icon: Cloud, color: 'text-status-info' },
  smee_relay: { icon: Unplug, color: 'text-role-agent' },
};

export function EventDetailModal({ event, onClose }: EventDetailModalProps) {
  const { t } = useTranslation();
  const { copied: copiedPayload, copy } = useCopyToClipboard();
  const sourceConfig = event.source_type ? SOURCE_ICONS[event.source_type] : null;
  const SourceIcon = sourceConfig?.icon;
  const showReason = classifyEventReason(event).kind !== 'none';

  const handleCopy = () => {
    const text = (() => { try { return JSON.stringify(JSON.parse(event.payload!), null, 2); } catch { return event.payload!; } })();
    copy(text);
  };

  return (
    <BaseModal
        isOpen
        onClose={onClose}
        titleId="event-detail-modal-title"
        size="full"
        portal
        staggerChildren={false}
        panelClassName="bg-background border border-hair rounded-card shadow-elevation-4 overflow-hidden flex flex-col max-h-[85vh]"
      >
        {/* ── Header ── */}
        <div className="flex items-start justify-between px-5 py-4 border-b border-hair flex-shrink-0 bg-surface-1">
          <div className="flex-1 min-w-0 pr-4">
            {/* Improvement #9: Color-coded event type badge */}
            <div className="flex items-center gap-2.5 mb-1.5">
              <h3
                id="event-detail-modal-title"
                className="typo-body-lg text-ink-1 tracking-tight"
              >
                {event.event_type}
              </h3>
              {/* Improvement #4: Status badge with color coding */}
              <EventStatusMark status={event.status} />
            </div>
            {/* Improvement #6: Relative + absolute timestamp */}
            <div className="flex items-center gap-1.5 typo-caption text-ink-2">
              <Clock className="w-3 h-3" />
              <span>{formatRelativeTime(event.created_at)}</span>
              <span className="text-ink-1">&middot;</span>
              <span className="font-mono">{<AbsoluteTime timestamp={event.created_at} />}</span>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 rounded-card hover:bg-surface-2 text-ink-1 hover:text-ink-1 transition-colors focus-ring"
            aria-label={t.common.close}
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* ── Body — flex-1 so {t.triggers.event_data} fills remaining space ── */}
        <div className="flex-1 flex flex-col min-h-0 overflow-hidden">
          {/* Improvement #7: Metadata grid with better visual hierarchy */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-px bg-surface-1 border-b border-hair flex-shrink-0">
            <MetaCell icon={Hash} label={t.triggers.meta_event_id}>
              <UuidLabel value={event.id} />
            </MetaCell>
            <MetaCell icon={FolderOpen} label={t.triggers.meta_project}>
              <UuidLabel value={event.project_id} />
            </MetaCell>
            {/* Improvement #5: Source type icon + styled chip */}
            {event.source_id && (
              <MetaCell icon={SourceIcon ?? Hash} iconColor={sourceConfig?.color} label={t.triggers.meta_source}>
                <div className="flex items-center gap-1.5">
                  {event.source_type && (
                    <span className={`typo-caption px-1.5 py-0.5 rounded-input bg-surface-2 border border-hair ${sourceConfig?.color ?? 'text-ink-1'}`}>
                      {event.source_type}
                    </span>
                  )}
                  <UuidLabel value={event.source_id} />
                </div>
              </MetaCell>
            )}
            {event.processed_at && (
              <MetaCell icon={Clock} label={t.triggers.meta_processed}>
                <span className="font-mono text-ink-1">
                  {<AbsoluteTime timestamp={event.processed_at} />}
                </span>
              </MetaCell>
            )}
          </div>

          {/* Improvement #1: Event Data fills remaining modal height */}
          {event.payload && (
            <div className="flex-1 flex flex-col min-h-0 overflow-hidden">
              {/* Improvement #3: Themed section label */}
              <div className="flex items-center justify-between px-5 py-2.5 border-b border-primary/8 flex-shrink-0 bg-surface-1">
                <span className="typo-label text-ink-1">
                  {t.triggers.event_data_section_label}
                </span>
                {/* Improvement #10: Copy button with improved hover/animation */}
                <button
                  type="button"
                  onClick={handleCopy}
                  className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-card typo-caption transition-all duration-200 ${
                    copiedPayload
                      ? 'bg-status-success/10 text-status-success border border-status-success/20'
                      : 'text-ink-1 hover:text-ink-1 hover:bg-surface-2 border border-transparent hover:border-hair'
                  }`}
                  title={t.triggers.copy_event_data_title}
                >
                  {copiedPayload ? (
                    <>
                      <Check className="w-3 h-3" />
                      {t.triggers.copied_label}
                    </>
                  ) : (
                    <>
                      <Copy className="w-3 h-3" />
                      {t.triggers.copy_json}
                    </>
                  )}
                </button>
              </div>
              {/* Improvement #2: JSON syntax highlighting + fills height */}
              <div className="flex-1 overflow-y-auto px-5 py-3 bg-background/60">
                <HighlightedJson raw={event.payload} />
              </div>
            </div>
          )}

          {/* If no payload, show empty state */}
          {!event.payload && !showReason && (
            <div className="flex-1 flex items-center justify-center text-ink-1 typo-body">
              {t.triggers.no_event_data}
            </div>
          )}

          {/* Improvement #8: Error section with icon and improved styling.
              The same column carries the bus's gate tokens ("why nothing ran")
              and genuine failure text — EventReasonNote tells them apart and
              never invents a reason for a row that has none. */}
          {showReason && (
            <div className="flex-shrink-0 border-t border-status-error/15 bg-status-error/3">
              <div className="flex items-center gap-2 px-5 py-2.5 border-b border-status-error/10">
                <AlertCircle className="w-3.5 h-3.5 text-status-error" />
                <span className="typo-label text-status-error">
                  {t.triggers.error_section_label}
                </span>
              </div>
              <div className="px-5 py-3">
                <EventReasonNote event={event} />
              </div>
            </div>
          )}
        </div>
      </BaseModal>
  );
}

/** Metadata cell for the info grid */
function MetaCell({ icon: Icon, iconColor, label, children }: {
  icon: typeof Hash;
  iconColor?: string;
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="bg-background/60 px-4 py-3">
      <div className="flex items-center gap-1.5 mb-1">
        <Icon className={`w-3 h-3 ${iconColor ?? 'text-ink-1'}`} />
        <span className="typo-eyebrow text-ink-1">
          {label}
        </span>
      </div>
      <div className="typo-body text-ink-1 truncate">
        {children}
      </div>
    </div>
  );
}
