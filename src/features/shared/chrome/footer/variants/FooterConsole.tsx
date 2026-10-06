import type { ReactNode } from 'react';
import { Button } from '@/features/shared/components/buttons';
import { Tooltip } from '@/features/shared/components/display/Tooltip';
import {
  AthenaFooterIcon, FleetDebugLogFooterPill, FleetFooterIcon, PluginContextSelectors,
} from '../lazyFooterIcons';
import { CpuGlyph } from './FooterGlyphs';
import {
  AccountControl, GuidanceControl, NetworkControl, NotepadControl, ShortcutsControl,
  SidebarControl, ThemeControl, type KeyProps, type Skin,
} from './FooterControls';
import { Hosted, useLoadReadout } from './FooterShared';
import { FooterCenter, type FooterModel } from './FooterFrame';
import { useFooterHeight } from './footerHooks';

// VARIANT 1: "Console".
//
// The footer as a hardware strip. Controls sit in recessed BAYS grouped by
// what they govern (the shell, how it looks, the work, the machine), each a
// 36px key carrying a 24px duotone glyph. State is a lit LED bar under the
// glyph, never a corner dot that collides with a badge: primary when engaged,
// success when healthy, warning for dev-only doors. The machine bay is a real
// instrument: a CPU die that fills with load beside two meters with figures.

const LED: Record<NonNullable<KeyProps['signal']>, string> = {
  on: 'bg-primary', ok: 'bg-status-success', dev: 'bg-status-warning',
};

function ConsoleKey(p: KeyProps) {
  return (
    <Tooltip content={p.label}>
      <Button variant="ghost" size="icon-md" onClick={p.onClick} onContextMenu={p.onContextMenu}
        onPointerEnter={p.onPointerEnter} disabled={p.disabled} aria-label={p.label}
        aria-pressed={p.pressed} data-testid={p.testId}
        className={`relative ${p.pressed ? 'bg-primary/15 text-primary' : ''}`}>
        {p.glyph}
        {p.signal && <span className={`absolute bottom-0.5 left-1/2 -translate-x-1/2 h-0.5 w-4 rounded-full ${LED[p.signal]}`} />}
      </Button>
    </Tooltip>
  );
}

const SKIN: Skin = { Key: ConsoleKey, weight: 'duo', g: 'w-6 h-6' };

function Bay({ children }: { children: ReactNode }) {
  return (
    <div className="flex items-center gap-0.5 h-10 px-0.5 rounded-card bg-secondary/40 border border-primary/10">
      {children}
    </div>
  );
}

function Meter({ pct, bg }: { pct: number; bg: string }) {
  return (
    <div className="flex items-center gap-1.5">
      <div className="h-1.5 w-10 rounded-full bg-foreground/10 overflow-hidden">
        <div className={`h-full rounded-full transition-[width] duration-500 ease-out ${bg}`}
          style={{ width: `${Math.min(100, Math.max(0, pct))}%` }} />
      </div>
      <span className="typo-caption text-foreground tabular-nums w-7 text-right">{Math.round(pct)}%</span>
    </div>
  );
}

function LoadInstrument() {
  const load = useLoadReadout();
  return (
    <Tooltip content={load.tooltip}>
      <div role="status" aria-label={`${load.label}: ${load.headroom}`} data-testid="footer-system-load"
        className="flex items-center gap-2 h-9 pl-1.5 pr-2.5">
        <CpuGlyph load={load.cpu / 100} className={`w-6 h-6 transition-colors ${load.tone.text}`} />
        <div className="flex flex-col leading-none gap-0.5">
          <Meter pct={load.cpu} bg={load.tone.bg} />
          <Meter pct={load.memUsedPct} bg={load.tone.bg} />
        </div>
      </div>
    </Tooltip>
  );
}

export default function FooterConsole({ model }: { model: FooterModel }) {
  useFooterHeight(48);
  const dev = import.meta.env.DEV;
  return (
    <div role="contentinfo"
      className={`fixed bottom-0 left-0 right-0 ${model.z} flex items-center justify-between gap-2 px-3 h-12 border-t border-primary/10 bg-background`}>
      <div className="flex items-center gap-2">
        <Bay><SidebarControl skin={SKIN} /></Bay>
        <Bay>
          <AccountControl skin={SKIN} />
          <ThemeControl skin={SKIN} />
          <ShortcutsControl skin={SKIN} />
        </Bay>
        {(dev || model.athenaEnabled) && (
          <Bay>
            {dev && <NetworkControl skin={SKIN} />}
            {model.athenaEnabled && <Hosted><AthenaFooterIcon /></Hosted>}
          </Bay>
        )}
      </div>

      <FooterCenter model={model} />

      <div className="flex items-center gap-2">
        <Bay>
          <NotepadControl skin={SKIN} />
          {dev && <Hosted w="w-0"><FleetDebugLogFooterPill /></Hosted>}
          {dev && <Hosted w="w-16"><FleetFooterIcon /></Hosted>}
        </Bay>
        <Bay><LoadInstrument /></Bay>
        <GuidanceControl skin={SKIN} />
        <Hosted w="w-0"><PluginContextSelectors /></Hosted>
      </div>
    </div>
  );
}
