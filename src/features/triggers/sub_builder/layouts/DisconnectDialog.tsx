/**
 * Confirmation dialog for disconnecting a persona from an event.
 */
import { AlertTriangle, X } from 'lucide-react';

interface Props {
  open: boolean;
  personaName: string;
  eventLabel: string;
  onConfirm: () => void;
  onCancel: () => void;
}

export function DisconnectDialog({ open, personaName, eventLabel, onConfirm, onCancel }: Props) {
  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center" onClick={onCancel}>
      <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" />
      <div
        className="relative w-[380px] rounded-2xl bg-card border border-primary/15 shadow-elevation-4 overflow-hidden"
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-start gap-3 px-4 py-4">
          <div className="w-9 h-9 rounded-modal flex items-center justify-center bg-red-500/10 flex-shrink-0">
            <AlertTriangle className="w-4.5 h-4.5 text-red-400" />
          </div>
          <div className="flex-1 min-w-0">
            <h3 className="text-sm font-semibold text-foreground mb-1">Disconnect persona?</h3>
            <p className="text-xs text-muted-foreground leading-relaxed">
              <span className="font-medium text-foreground/80">{personaName}</span> will no longer react to{' '}
              <span className="font-medium text-foreground/80">{eventLabel}</span> events. You can reconnect later.
            </p>
          </div>
          <button onClick={onCancel} className="p-1 rounded-card hover:bg-secondary/60 text-muted-foreground flex-shrink-0">
            <X className="w-3.5 h-3.5" />
          </button>
        </div>

        <div className="flex items-center justify-end gap-2 px-4 py-3 border-t border-primary/10 bg-secondary/20">
          <button
            onClick={onCancel}
            className="px-3 py-1.5 rounded-card text-xs font-medium text-muted-foreground hover:text-foreground hover:bg-secondary/60 transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={onConfirm}
            className="px-3 py-1.5 rounded-card text-xs font-medium bg-red-500/15 text-red-400 hover:bg-red-500/25 border border-red-400/20 transition-colors"
          >
            Disconnect
          </button>
        </div>
      </div>
    </div>
  );
}
