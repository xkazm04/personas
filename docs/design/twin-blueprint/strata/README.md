# Twin blueprint, variant `strata`: exploded strata

Metaphor: the twin is four translucent plates stacked in isometric projection and pulled apart along one axis (Identity on top, then Voice, Knowledge, Training). Each plate's top face draws its section's quantities, and its fill runs to that section's `sectionCoverage`. Flat callouts on leader lines carry the labels at full type size. All tints come from `--primary`.

- `detail-*`: L1 on the one-channel twin. You see the exploded stack, the floor footprint, assembly lines through the side corners, and one callout per plate with its headline fill and three counts.
- `detail-empty-*`: a twin that was just forged. Every unmeasured quantity is hatched or dashed. Training has no plan yet, so its plate shows "-" and "Not drawn yet".
- `detail-rich-*`: the overflow test, with nine channels, eight goals and counts over their declared domains (the overflow chevrons on the bio, samples and topics).
- `detail-focus-*`: L2 for Voice. The plate lifts and flattens face-on into a panel with nine channel rows (samples, rules, directives, the 1..5 style profile, where the voice came from). The other three plates sit faded in a rail on the left.
- `stage-*`: the training base layer, mid-beat with the reconciled delta. The stack sits compressed in the left rail at lower contrast so the centre stays clear for the question card. The answered Training plate lifts, "+12%" lands on it, and the readout gives the gain and the model's reason.
- `stage-*` with `working` (`stage-working-*`): the empty twin while the engine works. A scan line passes down through the plates and the readout says "Reading your answers" (CSS loops; they are still frames here).
- Sizes are 1280x800 and 1920x1080, in the dark-midnight and light themes. Each shot comes from `node scripts/style/shoot.mjs --module twin/blueprint/<state> --tape synthetic --kit strata`.
