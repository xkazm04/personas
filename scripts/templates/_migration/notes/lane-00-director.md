# Notes - director

Read this file first. It carries corrections to the assignment that apply to every lane.

## 09:5x - TRAP - the WebSearch budget is shared across all ten lanes and it is now exhausted

Lane-05 hit the ceiling (about 200 searches per session, pooled across the ten of you) during
its third recipe. If your `WebSearch` calls are failing or returning nothing, that is why. It
is not a fault in your lane and it will not recover.

**Do not spend turns retrying it.** Adapt instead, in this order:

1. **`WebFetch` still works.** You know the authoritative sources in your domain by name:
   fetch them directly rather than searching for them. A standards body, an official
   documentation page, a primary study, a well-known practitioner reference. Lane-05 got the
   FTC's CAN-SPAM guidance this way after search was gone. Expect some 403s and certificate
   errors on government and paywalled sites, and when a fetch fails, write the point in a
   shape that is true without the figure you could not verify rather than asserting it.
2. **Read these notes.** Nine other lanes are publishing findings under `RESEARCH`, and
   several already generalize well past the lane that found them. Lane-02's small-sample
   statistics note improved a lane-05 recipe that has nothing to do with error triage.
3. **Your own knowledge is a legitimate third input.** The field guide's section 3c says so
   and means it. The requirement is that the recipe arrive **enriched**, not that a search
   happened. You know a great deal about most of these domains; the draft you are holding was
   written by transformation and does not.

**What you owe in return is provenance.** In your final report, say plainly which recipes got
search-backed research, which ran on fetch plus your own knowledge, and which ran on knowledge
alone. That sentence is what lets the operator decide where a second pass is worth buying. A
recipe enriched from knowledge is not a failure; a recipe silently claiming research it did
not get is.

**Never invent a citation, a figure or a study.** If you cannot verify a number, write the
shape of the finding without the number. "The decay is measured in minutes, not hours" is
true and useful; a fabricated multiplier is neither.

## 09:5x - PATTERN - three decisions from the early lanes that every lane should copy

These arrived from lanes 05 and 10 within the first hour and they are now house rules, so you
do not have to re-derive them:

- **Delete binding-shaped knobs from `input_schema`.** A knob naming a channel, a credential
  or a destination is a binding, and bindings live on the adopted charter. Also delete knobs
  whose **name** leaks a connector's private vocabulary (`subreddits` in a recipe that
  declares `social`); rename them to the general noun. But **rewrite, do not delete, a knob
  whose quantity is legitimate and whose description is merely bad**: a ceiling, a window or a
  batch size is a real adoption decision.
- **Act on `transformNotes`, then drop the array.** Some drafts carry notes addressed to you,
  the migrator. The moment you act on one it becomes false, and the gate ignores unknown
  fields so it will ship silently. Act, then remove. Never remove without acting.
- **The same connector in two recipes needs two different `examples/` files.** If you could
  paste the file into another recipe unchanged, you wrote a datasheet rather than a mapping.
  The test is whether the file stops applying when the recipe changes but the connector does
  not.
