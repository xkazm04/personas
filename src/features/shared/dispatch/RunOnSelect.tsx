// RunOnSelect — "Run on": this machine, or one of the operator's paired devices.
//
// The one device picker every dispatch door mounts (DispatchChooser, the
// Monitor's QuickDispatchDock), so the rules below cannot differ by door:
//
//   • HIDDEN ENTIRELY when this build has no p2p or no device is paired. A
//     picker whose only option is "This machine" is a question with one answer.
//   • An OFFLINE device stays selectable: the dispatch waits in this device's
//     outbox and goes out when the other one wakes, and the option says so.
//   • Every remote device is DISABLED, with the reason on the option, when the
//     work could not come back: the project has no git remote (a remote session
//     returns its work as a pushed branch), or the caller says this dispatch
//     prepares files on this machine first (`remoteBlockedReason`).
//
// Each option carries a reachability dot (`StatusDot`, shape + colour).
// `value` is the chosen device's peer id, or `null` for this machine.
//
// Not a `shared/components` primitive (it reads the store), so no `@catalog`.

import { useEffect } from 'react';
import { Check, ChevronDown, Laptop, Monitor } from 'lucide-react';
import { Listbox } from '@/features/shared/components/forms/Listbox';
import { StatusDot, type ConnectionState } from '@/features/shared/components/display/StatusDot';
import { useTranslation } from '@/i18n/useTranslation';
import type { DeviceReachability } from '@/lib/bindings/DeviceReachability';
import type { DispatchDevice } from '@/lib/bindings/DispatchDevice';
import { selectRemoteDispatchAvailable } from '@/stores/slices/network/remoteSessionsSlice';
import { useSystemStore } from '@/stores/systemStore';

const REACH_STATE: Record<DeviceReachability, ConnectionState> = {
  connected: 'live',
  stale: 'paused',
  offline: 'offline',
};

export interface RunOnSelectProps {
  /** The chosen device's peer id, or `null` for this machine. */
  value: string | null;
  onChange: (peerId: string | null) => void;
  /** The target project's git remote. `null`/empty disables every remote device. */
  githubUrl: string | null;
  /** A caller-side reason remote devices cannot take this dispatch at all. */
  remoteBlockedReason?: string | null;
  /** `up` for a trigger near the bottom of the window (the dock). */
  placement?: 'down' | 'up';
}

export function RunOnSelect({ value, onChange, githubUrl, remoteBlockedReason = null, placement = 'down' }: RunOnSelectProps) {
  const { t } = useTranslation();
  const c = t.common;
  const available = useSystemStore(selectRemoteDispatchAvailable);
  const devices = useSystemStore((s) => s.dispatchDevices);
  const load = useSystemStore((s) => s.loadRemoteSessions);

  // Reachability is read on mount and on focus; the snapshot push keeps it
  // current in between (see `remoteSessionsSlice`).
  useEffect(() => {
    void load();
    const onFocus = () => { void load(); };
    window.addEventListener('focus', onFocus);
    return () => window.removeEventListener('focus', onFocus);
  }, [load]);

  if (!available) return null;

  const blocked = remoteBlockedReason ?? (githubUrl?.trim() ? null : c.dispatch_run_on_needs_remote);
  const options: Array<{ id: string | null; device: DispatchDevice | null }> = [
    { id: null, device: null },
    ...devices.map((d) => ({ id: d.peerId, device: d })),
  ];
  const picked = devices.find((d) => d.peerId === value) ?? null;
  const reachLabel = (r: DeviceReachability) =>
    r === 'connected' ? c.dispatch_run_on_connected : r === 'stale' ? c.dispatch_run_on_stale : c.dispatch_run_on_offline;
  const choose = (id: string | null) => {
    if (id !== null && blocked) return;
    onChange(id);
  };
  const up = placement === 'up';

  return (
    <div className="flex min-w-0 items-center gap-2" data-testid="run-on-select">
      {!up && <span className="flex-shrink-0 typo-caption text-foreground">{c.dispatch_run_on_label}</span>}
      <Listbox
        ariaLabel={c.dispatch_run_on_aria}
        itemCount={options.length}
        onSelectFocused={(i) => choose(options[i]?.id ?? null)}
        portal={!up}
        className="relative min-w-0"
        menuClassName={`animate-fade-slide-in ${up ? 'absolute bottom-full left-0 mb-1 z-40' : ''} min-w-[16rem] overflow-hidden rounded-card border border-border bg-background py-1 shadow-elevation-3`}
        renderTrigger={({ isOpen, toggle }) => (
          <button
            type="button"
            onClick={toggle}
            aria-haspopup="listbox"
            aria-expanded={isOpen}
            aria-label={c.dispatch_run_on_aria}
            data-testid="run-on-trigger"
            className={`focus-ring flex min-w-0 items-center gap-1.5 whitespace-nowrap border px-2.5 transition-colors ${
              up ? 'h-6 rounded-pill typo-code' : 'h-8 rounded-interactive typo-caption'
            } ${picked ? 'border-sky-500/40 bg-sky-500/10 text-foreground' : 'border-card-border bg-card-bg text-foreground hover:border-primary/45'}`}
          >
            {picked ? <Laptop className="h-3 w-3 flex-shrink-0" aria-hidden /> : <Monitor className="h-3 w-3 flex-shrink-0" aria-hidden />}
            <span className="min-w-0 truncate">{picked ? picked.displayName : c.dispatch_run_on_this_machine}</span>
            <ChevronDown className={`h-3 w-3 flex-shrink-0 opacity-70 transition-transform ${isOpen ? 'rotate-180' : ''}`} aria-hidden />
          </button>
        )}
      >
        {({ close, focusIndex }) =>
          options.map((o, i) => {
            const d = o.device;
            const disabled = d !== null && blocked !== null;
            const hint = d === null ? null : disabled ? blocked : d.reachability === 'offline' ? c.dispatch_run_on_queued_hint : null;
            const selected = o.id === value;
            return (
              <button
                key={o.id ?? '__local'}
                type="button"
                role="option"
                aria-selected={selected}
                aria-disabled={disabled || undefined}
                disabled={disabled}
                onClick={() => { choose(o.id); close(); }}
                data-testid={`run-on-option-${o.id ?? 'local'}`}
                className={`flex w-full items-start gap-2 px-2.5 py-1.5 text-left transition-colors ${
                  disabled ? 'cursor-not-allowed opacity-50' : 'hover:bg-secondary/60'
                } ${focusIndex === i ? 'bg-secondary/60' : ''}`}
              >
                <span className="mt-0.5 w-3 flex-shrink-0">{selected && <Check className="h-3 w-3 text-primary" aria-hidden />}</span>
                <span className="min-w-0 flex-1">
                  <span className="flex items-center gap-1.5 typo-caption text-foreground">
                    {d ? <StatusDot kind="connection" state={REACH_STATE[d.reachability]} label={reachLabel(d.reachability)} pulse={false} />
                      : <Monitor className="h-3 w-3" aria-hidden />}
                    <span className="truncate">{d ? d.displayName : c.dispatch_run_on_this_machine}</span>
                    {d?.isHome && <span className="flex-shrink-0 typo-label text-primary">{c.dispatch_run_on_home}</span>}
                  </span>
                  {hint && <span className="block typo-label text-foreground opacity-70">{hint}</span>}
                </span>
              </button>
            );
          })
        }
      </Listbox>
    </div>
  );
}

export default RunOnSelect;
