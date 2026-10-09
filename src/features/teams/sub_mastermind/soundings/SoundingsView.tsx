// Soundings — the Mastermind portfolio as a nautical sounding chart, where
// DEPTH MEANS URGENCY. The owner's pick from the 2026-09 next-gen contest
// (docs/design/mastermind-soundings.md), and since 2026-09-25 the only view:
// the Hex Mosaic canvas it sat beside was retired.
//
//   L0 chart    every project a buoy at its urgency depth, reasons on the
//               waterline, relations as currents along the seabed
//   L1 station  the station widens into a water column; readings sit in four
//               lanes x the same four bands; the rest shrink to slivers
//   L2 sample   one reading (or, with I, the project file) rises into a card
//
// THIS FILE IS THE LAYOUT. It arranges blocks and owns nothing: the model is
// `useSoundings` (data from soundingsModel, positions from soundingsGeometry,
// level and focus from useSoundingsNav), the key grammar is
// `useSoundingsKeyboard`, Athena's is `useSoundingsCanvas`, and every region
// under `blocks/` reads what it needs from the context.
import { BaseModal } from '@/lib/ui/BaseModal';

import { IslandJumpPalette } from '../lib/IslandJumpPalette';
import { ChartDock } from './blocks/ChartDock';
import { ChartHeader } from './blocks/ChartHeader';
import { ChartWater } from './blocks/ChartWater';
import { CurrentArcs, CurrentLabels } from './blocks/Currents';
import { LiftedCard, SliverTip, SonarPings } from './blocks/LiftedCard';
import { StationBuoys } from './blocks/StationBuoys';
import { StationColumn } from './blocks/StationColumn';
import { SoundingsProvider } from './context';
import { SoundingsHelp } from './SoundingsHelp';
import { useSoundings } from './useSoundings';
import { useSoundingsCanvas } from './useSoundingsCanvas';
import { useSoundingsKeyboard } from './useSoundingsKeyboard';
import type { SoundingsViewProps } from './soundingsProps';
import './soundings.css';

export type { SoundingsViewProps };

export default function SoundingsView(props: SoundingsViewProps) {
  const model = useSoundings(props);
  useSoundingsKeyboard(model);
  useSoundingsCanvas(model);

  const { n, settling, geo, nav, words, indexOf } = model;
  const { m, tx } = words;
  const { level, goL0, goL1, closeCard, jumpOpen, setJumpOpen, helpOpen, setHelpOpen, say, rootRef } = nav;
  const { g, chartRef, booted, settled } = geo;

  // A click on the water itself rises one level: the chart has no close button.
  const onChartClick = (e: React.MouseEvent<HTMLElement>) => {
    const tgt = e.target as HTMLElement;
    if (tgt === e.currentTarget || tgt.dataset.water !== undefined) {
      if (level === 2) closeCard();
      else if (level === 1) goL0();
    }
  };

  const rootCls = ['sd-root', booted ? '' : 'sd-ghost', settled ? 'sd-settled' : '', nav.busy ? 'sd-busy' : ''].filter(Boolean).join(' ');

  return (
    <SoundingsProvider model={model}>
      <div ref={rootRef} className={rootCls} data-level={level} data-testid="mm-soundings">
        <ChartHeader />

        <main ref={chartRef} className="sd-chart" aria-label={m.soundings_chart_label} onClick={onChartClick}>
          {g && (
            <>
              <ChartWater />
              <CurrentArcs />
              <StationBuoys />
              <StationColumn />
              <CurrentLabels />
              <LiftedCard />
              <SonarPings />
              <SliverTip />
            </>
          )}
          {n === 0 && !settling && <div className="sd-empty">{m.soundings_empty}</div>}
        </main>

        <ChartDock />

        {jumpOpen && (
          <IslandJumpPalette
            islands={model.stations.map((s) => s.island)}
            onJump={(slug) => { const i = indexOf.get(slug); if (i !== undefined) goL1(i); }}
            onMiss={(query) => say('chart', tx(m.jump_missed, { query }))}
            onClose={() => setJumpOpen(false)}
          />
        )}

        <BaseModal isOpen={helpOpen} onClose={() => setHelpOpen(false)} titleId="sd-help-title" size="lg">
          <SoundingsHelp />
        </BaseModal>
      </div>
    </SoundingsProvider>
  );
}
