// The L2 Overview's scans as the Contexts Section's actions: KitButtons, so a
// running scan shows the product's real spinner with disabled + aria-busy
// (the old Deck toolbar hand-rolled an animate-spin icon and a raw hue border
// per button). Feature and agent scans are named, not coloured.
import { KitButton } from '@/features/shared/components/kit';
import type { FactoryWords } from '../useFactoryWords';
import type { FactoryL2Data } from './factoryL2Data';
import { useFactoryScans } from './useFactoryScans';

export function FactoryScanActions({ data, onNote, w }: { data: FactoryL2Data; onNote: (s: string) => void; w: FactoryWords }) {
  const s = useFactoryScans(data, onNote);
  const noProject = !data.project;
  return (
    <span className="flex flex-wrap items-center gap-2" data-testid="factory-cons-toolbar">
      <KitButton onClick={() => { if (!noProject && !s.kpiScanning) void s.scanKpisNow(); }} loading={s.kpiScanning} testId="factory-scan-kpis">{w.t.kpis.scan_button}</KitButton>
      <KitButton onClick={() => { if (data.contexts.length > 0 && !data.useCaseState.scanning) s.scanFeatures(); }} loading={data.useCaseState.scanning} testId="factory-scan-features">{w.L.scanFeatures}</KitButton>
      <KitButton onClick={() => { if (!noProject && !s.ctxScanning) s.scanContexts(true); }} loading={s.ctxScanning} testId="factory-rescan-contexts">{w.L.rescanContexts}</KitButton>
      <KitButton quiet onClick={() => { if (!noProject && !s.ctxScanning) s.scanContexts(false); }} loading={s.ctxScanning} testId="factory-full-scan">{w.L.fullScan}</KitButton>
    </span>
  );
}
