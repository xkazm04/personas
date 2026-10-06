import type { ReactNode } from 'react';
import { Button } from '@/features/shared/components/buttons';
import { Tooltip } from '@/features/shared/components/display/Tooltip';
import {
  AthenaFooterIcon, FleetDebugLogFooterPill, FleetFooterIcon, PluginContextSelectors,
} from '../lazyFooterIcons';
import {
  AccountControl, GuidanceControl, NetworkControl, NotepadControl, ShortcutsControl,
  SidebarControl, ThemeControl, type KeyProps, type Skin,
} from './FooterControls';
import { Hosted, useLoadReadout } from './FooterShared';
import { FooterCenter, type FooterModel } from './FooterFrame';
import { useFooterHeight } from './footerHooks';

// VARIANT 3: "Signal Rail".
//
// Icon-only, but every mark is SOLID: filled 24px silhouettes on round keys,
// so the bar reads as a row of objects instead of a row of outlines. No
// hairline dividers; groups are separated by air and claimed by a SIGNAL
// SEGMENT on the bar's top edge, coloured by what the group governs (shell
// neutral, work primary, machine by headroom). State rides the key's ring,
// never a corner dot: primary when engaged, success when healthy, warning for
// a dev-only door. Machine load is a twin-ring gauge, CPU outside, RAM inside.

const RING: Record<NonNullable<KeyProps['signal']>, string> = {
  on: 'ring-2 ring-primary/60 bg-primary/15 text-primary',
  ok: 'ring-2 ring-status-success/50',
  dev: 'ring-2 ring-status-warning/50 text-status-warning',
};

function RailKey(p: KeyProps) {
  const state = p.pressed ? 'on' : p.signal;
  return (
    <Tooltip content={p.label}>
      <Button variant="ghost" size="icon-md" onClick={p.onClick} onContextMenu={p.onContextMenu}
        onPointerEnter={p.onPointerEnter} disabled={p.disabled} aria-label={p.label}
        aria-pressed={p.pressed} data-testid={p.testId}
        className={`rounded-full! ${state ? RING[state] : ''}`}>
        {p.glyph}
      </Button>
    </Tooltip>
  );
}

const SKIN: Skin = { Key: RailKey, weight: 'solid', g: 'w-6 h-6' };

function Group({ accent, children }: { accent: string; children: ReactNode }) {
  return (
    <div className="relative flex items-center gap-1 h-full">
      <span className={`absolute top-0 inset-x-1 h-0.5 rounded-full ${accent}`} aria-hidden="true" />
      {children}
    </div>
  );
}

function Arc({ r, pct }: { r: number; pct: number }) {
  const c = 2 * Math.PI * r;
  const on = (Math.min(100, Math.max(0, pct)) / 100) * c;
  return (
    <>
      <circle cx="18" cy="18" r={r} stroke="currentColor" strokeOpacity={0.15} strokeWidth={3} fill="none" />
      <circle cx="18" cy="18" r={r} stroke="currentColor" strokeWidth={3} fill="none" strokeLinecap="round"
        strokeDasharray={`${on} ${c}`} transform="rotate(-90 18 18)"
        style={{ transition: 'stroke-dasharray 500ms ease-out' }} />
    </>
  );
}

function LoadGauge({ load }: { load: ReturnType<typeof useLoadReadout> }) {
  return (
    <Tooltip content={load.tooltip}>
      <div role="status" aria-label={`${load.label}: ${load.headroom}`} data-testid="footer-system-load"
        className={`relative w-9 h-9 ${load.tone.text}`}>
        <svg viewBox="0 0 36 36" className="w-9 h-9" aria-hidden="true">
          <Arc r={15.5} pct={load.cpu} />
          <Arc r={10.5} pct={load.memUsedPct} />
        </svg>
        <span className="absolute inset-0 flex items-center justify-center typo-caption font-semibold text-foreground tabular-nums">
          {Math.round(load.cpu)}
        </span>
      </div>
    </Tooltip>
  );
}

export default function FooterRail({ model }: { model: FooterModel }) {
  useFooterHeight(44);
  const dev = import.meta.env.DEV;
  const load = useLoadReadout();
  return (
    <div role="contentinfo"
      className={`fixed bottom-0 left-0 right-0 ${model.z} flex items-center justify-between px-3 h-11 border-t border-primary/10 bg-background`}>
      <div className="flex items-center gap-5 h-full">
        <Group accent="bg-foreground/25">
          <SidebarControl skin={SKIN} />
          <AccountControl skin={SKIN} />
          <ThemeControl skin={SKIN} />
          <ShortcutsControl skin={SKIN} />
        </Group>
        {(dev || model.athenaEnabled) && (
          <Group accent="bg-primary/70">
            {dev && <NetworkControl skin={SKIN} />}
            {model.athenaEnabled && <Hosted><AthenaFooterIcon /></Hosted>}
          </Group>
        )}
      </div>

      <FooterCenter model={model} />

      <div className="flex items-center gap-5 h-full">
        <Group accent="bg-primary/70">
          <NotepadControl skin={SKIN} />
          {dev && <Hosted w="w-0"><FleetDebugLogFooterPill /></Hosted>}
          {dev && <Hosted w="w-16"><FleetFooterIcon /></Hosted>}
          <GuidanceControl skin={SKIN} />
        </Group>
        <Group accent={load.tone.bg}>
          <LoadGauge load={load} />
        </Group>
        <div className="flex items-center gap-1"><Hosted w="w-0"><PluginContextSelectors /></Hosted></div>
      </div>
    </div>
  );
}
