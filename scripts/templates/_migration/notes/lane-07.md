# Notes - lane-07

General professional: correspondence, decisions, digests, goals, knowledge (10 recipes)

Append below. Newest last. See ../FIELD_GUIDE.md section 6 for the format.

## 09:35 - TRAP - the drafts talk about the migration, and the registry cannot hear it
- Several scaffolded drafts say things like "the v2 default of every four hours", "the
  source fixed it at twenty", "the v2 row already listens for". A reader in the registry
  has no v2 and no source. Keep the *reason* the number was wrong and delete the pointer:
  "an interval fixed in advance" rather than "the v2 default". Check `recommended_trigger.
  rationale` and `personalization_needs` in particular, that is where they cluster.

## 09:38 - PATTERN - declare the connector types the OUTCOMES require, not the ones the subject suggests
- Three of my drafts arrived with `connector_types: []` and a note saying a human must
  supply one. The way out is not to guess the subject matter. Read your own outcomes: if
  one says "the next run starts from what this one recorded" you need a `database` or a
  `knowledge_base`, and if another says "delivered as one message" you need `messaging`.
  Those are load-bearing and defensible. The activity *sources* a general recipe reads
  over usually cannot be typed at all, and saying so in `personalization_needs` is better
  than inventing a type that binds to the wrong thing.

## 09:41 - RESEARCH - silence is not a result, an empty delivery is
- Field guide 3b says recording a zero is the work. The named engineering form is the
  dead man's switch or heartbeat alert (Prometheus ships a `Watchdog` alert that fires
  permanently, and its *absence* is the alarm). This reverses a very common draft
  sentence: "stay silent when there is nothing to say" leaves the reader unable to tell a
  quiet week from a watch that died. The sharper contract is that the quiet edition is
  still delivered and simply holds the counts. If your recipe monitors anything, check
  whether its draft promises silence, and change it.

## 09:44 - RESEARCH - four sources that cover a lot of ground outside my lane
- ICD 203 (ODNI analytic standards) requires a product to separate what is *known* from
  what is *assumed* from what is *judged*, to name the linchpin assumption, and to name
  the indicator that would change the judgment. That is a ready-made outcome for any
  recipe that reports a conclusion. Pairs with BLUF (finding first, reasoning under it).
- "Watermelon reporting" (green outside, red inside) is the named failure of any status
  or review recipe with no negative finding. Better than inventing a phrase for it.
- Queue health: the metric is the *age of the oldest unserviced item*, not the queue
  length (AWS calls it ApproximateAgeOfOldestMessage). Little's Law only holds in steady
  state, so a backlog that is growing has no stable average wait to quote. Useful for any
  recipe with a pending queue in it.
- Alert/alarm fatigue has real numbers if you need one that decides something: 85 to 99
  per cent of clinical alarms are false or insignificant; security operations centres
  average around 3,000 alerts a day with roughly two thirds never addressed.

## 09:47 - GATE - an examples[] entry with no file is a note, not a failure
- The gate prints `examples[0] names connector "x" with no examples/x.md beside it` and
  still passes the lane. It is easy to leave those standing. The scaffold copies the v2
  `examples` array in wholesale, so if you do nothing you inherit a note per recipe. Write
  the file or drop the entry, and note that the entry's `notes` string is a good seed for
  the file but a bad substitute: the worked example puts "See examples/x.md." in the JSON
  and the actual knowledge in the file.
## 10:40 - DECISION - a count of approvals is the wrong evidence for granting autonomy
- My drafting recipe arrived with "twenty consecutive unedited approvals graduates a
  contact to auto-send". Research on automation bias says a run of approvals is the
  *symptom*, not the evidence: when a real problem was put in front of human reviewers of
  mostly-correct automated output, catch rates measured between roughly one in ten and one
  in four, and a benign history is what produces that. Radiologists with fifteen years of
  experience dropped from about 82 per cent accuracy to under 50 when the system was wrong.
- The rewrite: grant autonomy on **how little the human changed the draft**, never on how
  often they pressed approve, and add a criterion that an approval returned faster than the
  draft could have been read does not count. Pair it with a holdback window so an
  unreviewed send is still stoppable, because graduated autonomy without a reversal path is
  just a delayed mistake.
- Applies to any recipe in this corpus with a human-approval gate, a confidence threshold
  that unlocks unattended action, or a "proven reliable, now let it run" step.

## 10:44 - RESEARCH - trust decay, for anything a person has to consult
- The framing that reshaped two of my recipes, and it is not specific to knowledge bases:
  a reference a human consults does not fail by being wrong, it fails by not being believed
  enough to open. Practitioner accounts describe a trust death spiral where a reader who
  hits two or three wrong pages stops checking the source entirely and asks a person
  instead, after which fewer people visit, so fewer notice what has gone stale.
- Two consequences worth stealing. **A contradiction costs more trust than a gap**: two
  answers to the same question ends a reader faster than no answer, and it is almost always
  discovered by the person it misled rather than by the owner. And **last-edited is not
  last-verified**: an unedited page that is still true and one that went wrong in spring are
  indistinguishable by age, so any recipe judging freshness on an edit date is measuring the
  wrong thing and will report a dead reference as fresh.
- I could not verify the circulating percentages for how many articles in a base contain a
  contradiction (they trace to vendor blogs citing a survey I could not reach), so I wrote
  the shape without the number. Recommend the same.

## 10:47 - PATTERN - "the real product is what it left out" becomes two criteria, not a guidance sentence
- Three of my recipes suppress far more than they surface, and the draft language for that
  was always a guidance clause ("a short accurate list beats a complete one"), which is
  unfalsifiable. The pair of criteria that made it checkable, and that I would now reach for
  in any filtering, triaging or digesting recipe:
  1. the output states **its denominator** (how many were looked at, how many surfaced), and
  2. what was dropped is named **by class**, not left implicit, so a wrong exclusion is
     visible without going back to the source.
- The reason this is worth the words: a short list gives the reader no way to tell a good
  filter from a broken one, so the first time something important is missing they revert to
  reading everything and the recipe has cost them twice. Reporting the cut is what makes the
  cut trustworthy, and it is the same move as FIELD_GUIDE 3b's "recording a zero", applied
  to the things you decided against rather than to the things you failed to find.
