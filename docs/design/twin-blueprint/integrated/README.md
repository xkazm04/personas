# Twin blueprint, integrated (WP6)

Spark `twin-portable-blueprint`, 2026-10-01. These shots are the REAL route
(`TwinPage` -> the `setup` tab, and the experience overlay over it) on the
synthetic tape in `scripts/style/page-harness/twinDetailTapes.mjs`: every
number comes through the page's own reads (store slices, `twin_setup_get`,
memories, facts, training answers), not from a fixture model. The blueprint is
the default variant, **Drafting sheet**, as its package left it at shooting
time; the other three variants keep their own fixture shots beside this folder.

The twin: four voiced channels (generic preset, email learned, slack rolled,
teams hand-written) and WhatsApp bound but unvoiced, 7 approved / 2 pending /
1 rejected memories, three self-facts and one contact fact (left out of the
Knowledge count), eight tagged training answers, a ready plan with seven goals,
readiness 80%. The sample-proposal command answers with an error, as it does
until the learn-from-sample backend lands, so the "to review" chip is hidden.

| File | What it shows |
|---|---|
| `detail-<size>-<theme>.png` | The Detail page at L1: the header (sigil, name, role, readiness, **Carry on setting up**, **Start a training round**, Export, the blueprint style switcher) over the blueprint. |
| `stage-dealt-<size>-<theme>.png` | The training overlay with the live question dealt: the hand (card, fan of three, composer) floating in its column over the blueprint in stage mode; the blueprint stays readable to either side. |
| `stage-<size>-<theme>.png` | The training overlay after the surface plays the card (Enter on the table): the hand has lifted, the blueprint shows the scored answer (coverage gain on the goal's topic and the reason it counted), and with no next question yet (the deep pass is running) the blueprint is the waiting surface. Within the first two seconds this is the beat; after it, the same frame holds until a question is live. |

Sizes `1280x800` and `1920x1080`, themes `dark-midnight` and `light`. Re-shoot:

```
node scripts/style/shoot.mjs --module twin/detail --tape synthetic --sizes 1280x800,1920x1080 --themes dark-midnight,light --out docs/design/twin-blueprint/integrated --label detail
node scripts/style/shoot.mjs --module twin/stage-dealt --tape synthetic --sizes 1280x800,1920x1080 --themes dark-midnight,light --out docs/design/twin-blueprint/integrated --label stage-dealt
node scripts/style/shoot.mjs --module twin/stage --tape synthetic --sizes 1280x800,1920x1080 --themes dark-midnight,light --out docs/design/twin-blueprint/integrated --label stage
```

Add `--kit strata|dossier|radial` to shoot another variant on the same page.
Not shot here: L2 and the L3 drawer (they are reached through the variant's own
controls, which differ per variant).
