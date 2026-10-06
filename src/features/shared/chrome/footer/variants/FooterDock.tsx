import type { ReactNode } from 'react';
import { Button } from '@/features/shared/components/buttons';
import { Tooltip } from '@/features/shared/components/display/Tooltip';
import {
  AthenaFooterIcon, FleetDebugLogFooterPill, FleetFooterIcon, PluginContextSelectors,
} from '../lazyFooterIcons';
import { CpuGlyph, MemoryGlyph } from './FooterGlyphs';
import {
  AccountControl, GuidanceControl, NetworkControl, NotepadControl, ShortcutsControl,
  SidebarControl, ThemeControl, type KeyProps, type Skin,
} from './FooterControls';
import { Hosted, useLoadReadout } from './FooterShared';
import { FooterCenter, type FooterModel } from './FooterFrame';
import { useFooterHeight } from './footerHooks';

// VARIANT 2: "Status Dock".
//
// The footer as a status bar that SAYS things. Every control is a full-height
// CELL, hairline-separated, and a cell that has a value prints it at body
// size next to its glyph: your first name, the theme's name, the tour's
// 3/7, CPU and RAM as figures beside a die and a stick that fill with them.
// The question the baseline made you hover for ("which theme is this?",
// "how loaded is the machine?") is answered at a glance. Engaged state is a
// primary edge along the cell's top, the bar's own border lit.

const EDGE: Record<NonNullable<KeyProps['signal']>, string> = {
  on: 'bg-primary', ok: 'bg-status-success', dev: 'bg-status-warning',
};

function DockKey(p: KeyProps) {
  const edge = p.pressed ? 'on' : p.signal;
  return (
    <Tooltip content={p.label}>
      <Button variant="ghost" size="sm" onClick={p.onClick} onContextMenu={p.onContextMenu}
        onPointerEnter={p.onPointerEnter} disabled={p.disabled} aria-label={p.label}
        aria-pressed={p.pressed} data-testid={p.testId}
        className={`relative h-10 rounded-none! px-3! gap-2! ${p.pressed ? 'text-primary bg-primary/10' : ''}`}>
        {p.glyph}
        {p.text && <span className="typo-body font-medium text-foreground max-w-32 truncate hidden xl:inline">{p.text}</span>}
        {edge && <span className={`absolute top-0 inset-x-2 h-0.5 rounded-full ${EDGE[edge]}`} />}
      </Button>
    </Tooltip>
  );
}

const SKIN: Skin = { Key: DockKey, weight: 'duo', g: 'w-5.5 h-5.5' };

/** Full-height cells; `divide-x` draws the hairlines, so a control that renders null leaves none. */
function Cells({ children }: { children: ReactNode }) {
  return <div className="flex items-center h-full divide-x divide-primary/10">{children}</div>;
}

function LoadCell() {
  const load = useLoadReadout();
  return (
    <Tooltip content={load.tooltip}>
      <div role="status" aria-label={`${load.label}: ${load.headroom}`} data-testid="footer-system-load"
        className={`flex items-center gap-3 h-10 px-3 ${load.tone.text}`}>
        <span className="flex items-center gap-1.5">
          <CpuGlyph load={load.cpu / 100} className="w-5.5 h-5.5" />
          <span className="typo-body font-medium text-foreground tabular-nums">{Math.round(load.cpu)}%</span>
        </span>
        <span className="flex items-center gap-1.5">
          <MemoryGlyph used={load.memUsedPct / 100} className="w-5.5 h-5.5" />
          <span className="typo-body font-medium text-foreground tabular-nums">{Math.round(load.memUsedPct)}%</span>
        </span>
      </div>
    </Tooltip>
  );
}

function HostedCell({ children, w }: { children: ReactNode; w?: string }) {
  return <div className="flex items-center h-10 px-2"><Hosted w={w}>{children}</Hosted></div>;
}

export default function FooterDock({ model }: { model: FooterModel }) {
  useFooterHeight(40);
  const dev = import.meta.env.DEV;
  return (
    <div role="contentinfo"
      className={`fixed bottom-0 left-0 right-0 ${model.z} flex items-center justify-between h-10 border-t border-primary/15 bg-background`}>
      <Cells>
        <SidebarControl skin={SKIN} />
        <AccountControl skin={SKIN} />
        <ThemeControl skin={SKIN} />
        <ShortcutsControl skin={SKIN} />
        {dev && <NetworkControl skin={SKIN} />}
        {model.athenaEnabled && <HostedCell><AthenaFooterIcon /></HostedCell>}
      </Cells>

      <FooterCenter model={model} />

      <Cells>
        <NotepadControl skin={SKIN} />
        {dev && <HostedCell w="w-16"><FleetDebugLogFooterPill /><FleetFooterIcon /></HostedCell>}
        <LoadCell />
        <GuidanceControl skin={SKIN} />
        <HostedCell w="w-0"><PluginContextSelectors /></HostedCell>
      </Cells>
    </div>
  );
}
