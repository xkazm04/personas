// The fixture product: bp's synthetic sample, Kettle (a made-up studio-software company), TRIMMED to 30 features
// across 6 domains, 24 proposals (the sample's three packs among them) and 153 revision events. The Personas repo is
// public: every row here comes from bp's SYNTHETIC sample (bp src/data/kettle.*, src/lib/model/scan-sim.ts and
// train-sim.ts run with a fake clock), never from a live product store. Provenance: bp @ fbef867, trimmed by
// dropping features, contexts, KPI rows, lens-scan instructions and facet values no lens field reads.
import type { ScanSnapshot } from '@/lib/lensScan/wire';
import type { BlueprintData } from '../source';
import structure from './kettle.structure.json';
import events from './kettle.events.jsonl?raw';
import scan from './kettle.scan.json';

export const KETTLE_ROOT = 'C:/sample/kettle';

/** A deep copy of the scan, so one fixture session never edits another's rows. */
export const kettleScan = (): ScanSnapshot => structuredClone(scan) as unknown as ScanSnapshot;

/** The fixture product as the drawing reads it. */
export function kettleData(): BlueprintData {
  return {
    product: { projectId: 'fixture-kettle', name: 'Kettle', root: KETTLE_ROOT },
    structure: structuredClone(structure),
    events,
    scan: kettleScan(),
    storeVersion: 3,
  };
}
