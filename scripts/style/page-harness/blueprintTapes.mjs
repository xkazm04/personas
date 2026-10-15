// Synthetic tape for the blueprint drawing set (blueprintSurfaces.tsx). The sheet reads its product through the
// BlueprintData seam and never calls IPC, so the tape is empty: the harness needs one to mount, nothing more.
// The product itself is the trimmed Kettle fixture (src/features/decision-center/blueprint/fixture/), bp's
// SYNTHETIC sample: no row of any live store is on this tape or in the fixture.

export function blueprintTapes({ RECORDED_AT }) {
  return {
    builders: {
      'decision-center/blueprint': () => ({
        version: 1,
        module: 'decision-center/blueprint',
        source: 'synthetic',
        recordedAt: RECORDED_AT,
        note: 'Synthetic: empty. The drawing reads the Kettle fixture through the BlueprintData seam, not through IPC.',
        calls: [],
      }),
    },
  };
}
