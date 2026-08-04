import { useMemo, useState } from 'react';
import { AnimatePresence, LayoutGroup } from 'framer-motion';
import { Grid3x3, Rows3, Table2, Cpu, Bot, Gauge, MemoryStick } from 'lucide-react';
import { SegmentedTabs } from '@/features/shared/components/layout/SegmentedTabs';
import { Numeric } from '@/features/shared/components/display/Numeric';
import { makeMockFleet, fleetTotals, type ProtoTerminal } from './mockFleet';
import { VariantHeatboard } from './VariantHeatboard';
import { VariantTriageLanes } from './VariantTriageLanes';
import { VariantLedger } from './VariantLedger';
import { FullscreenTerminalMock } from './FullscreenTerminalMock';

type VariantId = 'heatboard' | 'lanes' | 'ledger';

const VARIANT_TABS = [
  { id: 'heatboard' as const, label: (<><Grid3x3 className="w-3.5 h-3.5" /> Heatboard</>) },
  { id: 'lanes' as const, label: (<><Rows3 className="w-3.5 h-3.5" /> Triage lanes</>) },
  { id: 'ledger' as const, label: (<><Table2 className="w-3.5 h-3.5" /> Ledger</>) },
];

/**
 * PROTOTYPE HOST — minimized Fleet monitor layer (/prototype round 1).
 *
 * Three directional variants for showing up to 50 terminals in minimal
 * space, each terminal carrying: state colour+icon, background-subprocess
 * count, subagents (active/total), and a resource-cost estimate
 * (output-token effort blended with process RAM). Clicking any terminal in
 * ANY variant expands it into the fullscreen layer-2 pane via a shared
 * framer-motion layoutId; Escape / back arrow collapses it into the exact
 * tile it came from. Data is a deterministic 50-session mock (mockFleet.ts
 * documents which real signal backs every field).
 *
 * DEV-only surface (Fleet plugin) — strings deliberately not i18n'd, same
 * as the rest of FleetPage; the winning variant gets extraction at
 * consolidation.
 */
export default function MonitorPrototypePage() {
  const [variant, setVariant] = useState<VariantId>('heatboard');
  const [openId, setOpenId] = useState<string | null>(null);
  const fleet = useMemo(() => makeMockFleet(50), []);
  const totals = useMemo(() => fleetTotals(fleet), [fleet]);
  const open = openId ? fleet.find((t) => t.id === openId) ?? null : null;

  const onOpen = (t: ProtoTerminal) => setOpenId(t.id);

  return (
    <div className="flex-1 min-h-0 flex flex-col px-4 pt-3 pb-2">
      <div className="flex items-center gap-3 pb-2 shrink-0 flex-wrap">
        <SegmentedTabs
          tabs={VARIANT_TABS}
          activeTab={variant}
          onTabChange={setVariant}
          ariaLabel="Monitor prototype variants"
          fullWidth={false}
          size="sm"
        />
        {/* Fleet-wide aggregates — the monitor's own header answer to
            "what is the whole fleet costing right now". */}
        <div className="flex items-center gap-3 typo-caption text-foreground opacity-70 flex-wrap">
          <span><Numeric value={fleet.length} /> sessions</span>
          <span className="text-blue-300"><Numeric value={totals.working} /> working</span>
          <span className="text-violet-300"><Numeric value={totals.awaiting} /> need you</span>
          <span className="inline-flex items-center gap-1"><Cpu className="w-3 h-3" /><Numeric value={totals.subprocs} /> bg procs</span>
          <span className="inline-flex items-center gap-1"><Bot className="w-3 h-3" /><Numeric value={totals.subagentsActive} /> agents live</span>
          <span className="inline-flex items-center gap-1"><Gauge className="w-3 h-3" /><Numeric value={totals.outputTokens} unit="compact" /> tok</span>
          <span className="inline-flex items-center gap-1"><MemoryStick className="w-3 h-3" /><Numeric value={Math.round(totals.memMb / 1024 * 10) / 10} /> GB</span>
        </div>
      </div>

      <LayoutGroup>
        <div className="relative flex-1 min-h-0 rounded-modal border border-primary/10 bg-[#0c0c0f] overflow-hidden">
          {variant === 'heatboard' && <VariantHeatboard fleet={fleet} onOpen={onOpen} />}
          {variant === 'lanes' && <VariantTriageLanes fleet={fleet} onOpen={onOpen} />}
          {variant === 'ledger' && <VariantLedger fleet={fleet} onOpen={onOpen} />}
          <AnimatePresence>
            {open && <FullscreenTerminalMock key={open.id} t={open} onClose={() => setOpenId(null)} />}
          </AnimatePresence>
        </div>
      </LayoutGroup>
    </div>
  );
}
