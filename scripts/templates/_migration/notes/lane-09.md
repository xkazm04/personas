# Notes - lane-09

Legal and compliance, plus product and project (10 recipes)

Append below. Newest last. See ../FIELD_GUIDE.md section 6 for the format.

## 09:38 - TRAP - the WebSearch budget is shared across all ten lanes and it is finite
- WebSearch returned "this session has used its web search budget (200 of 200)" partway
  through my second recipe. It is a per-session cap and ten agents draw on the same pool,
  so it will run out for everyone at roughly the same time.
- WebFetch appears to be on a separate budget. If you still have searches left, spend them
  on the two or three questions that cover several of your recipes at once rather than one
  per recipe, and write the finding into your lane note so the lanes that run dry can use it.
- If you are already dry: fetch known-good URLs directly with WebFetch, and lean harder on
  section 3b (what the running system taught) and 3c (your own judgment), which are the two
  inputs that do not need the network.

## 10:2x - DECISION - the advice boundary, in one outcome and one guidance clause, never a disclaimer
- Five of my recipes are contract work, where a recipe that reads as legal advice is a
  liability. lane-08 has the same problem with financial judgment. The shape that worked
  without turning the recipe into a warning label:
  - ONE outcome whose statement is the boundary as a claim about the world, not a caveat:
    "The review prepares a human's judgment and is never mistaken for it." Its criteria are
    checkable: findings are written as deviations from a stated position and as facts about
    the document rather than as conclusions about enforceability; every low-confidence
    passage is named with the text attached; the record names the human who accepted it.
  - ONE clause at the end of `guidance`: "This prepares a reviewer's judgment; the person
    who signs owns the verdict."
- That third criterion is the load-bearing one and it is not a disclaimer at all: naming the
  human who accepted the finding is what makes the boundary observable afterwards, and it
  doubles as the App Master "in flight needs an observable end" lesson. Recommend it
  anywhere a recipe produces something a professional is accountable for.

## 10:2x - PATTERN - for any deadline recipe, subtract twice and anchor to the last actionable day
- The sharpest correction research made to my lane, and it generalises past contracts. A
  renewal watch anchored to the end date is worthless: a December end with ninety days notice
  had to be decided in October, so the watch's first warning fires two months after the last
  day anything could be done. It looks like a working watch until the year it costs a term.
- The rule: the date to watch is the deadline MINUS the notice or lead requirement MINUS how
  long the action itself takes to arrange. Two subtractions. The second one is the one
  everybody drops, and it is why a ladder of 30/14/7 days is wrong for any obligation whose
  action needs a countersignature, a procurement cycle or a replacement vendor.
- The companion criterion that makes it checkable: "a register that holds the deadline but
  not the lead requirement is reported as unwatchable for this purpose rather than watched
  against the deadline, which is the failure that looks like coverage." Applies to filings,
  certificate renewals, invoice terms, SLA response windows, anything with a required notice.

## 10:2x - PATTERN - when you delete a binding-shaped knob, put a judgment knob in its place
- Following lane-10's call to strip channels and addresses out of `input_schema`, four of my
  recipes were left with an empty or near-empty knob list, which loses a place the adopter
  reads. In each case the recipe had grown a real quantity during enrichment that deserved to
  be exposed: how long a routed item may sit unclaimed, how long an item may be silent before
  it is read back from the source, how many unanswered raises before escalating, how long the
  decision itself takes.
- Those are judgments, they are connector-independent, and their `description` is a good place
  to put the one sentence of doctrine that would otherwise bloat `guidance` past 90 words.

## 11:0x - TRAP - the same connector in several recipes needs several DIFFERENT example files
- My lane carries three `notion.md`, two `gmail.md` and two `docusign.md`. The tempting move
  is to write one and copy it, and that produces exactly the failure the field guide warns
  about from a different direction: the file stops being about mapping THIS recipe onto the
  connector and becomes a page about the connector, which restates nothing useful.
- What worked: ask what this recipe in particular needs from the connector and write only
  that. Notion for an audit record is about one page per period and never overwriting;
  Notion for a review publication is about rate limits leaving a half written page that
  reads as complete; Notion for theme filing is about identity being a stored key because
  theme wording changes. Same connector, three disjoint files, none of them substitutable.
- The test that catches a lazy one: if you could paste the file under a different recipe in
  your own lane without editing it, it is about the connector and not about the mapping.

## 11:2x - DECISION - write the boundary of a regulated quantity instead of the quantity
- Per the director note. My lane is where a confidently wrong specific does real damage:
  notice periods, filing deadlines and control requirements vary by contract and by
  jurisdiction, and that variation is itself the thing the recipe should teach.
- The rule I settled on: state the ARITHMETIC and the SHAPE, never the period. "The date to
  watch is the deadline less the notice the contract itself requires less how long the
  decision takes" is durable everywhere. "Ninety days" is true of one contract. Where a
  concrete number makes the point vivid, write it as a worked example of the arithmetic
  ("a term ending in December with ninety days notice had to be decided in October") and
  put the variation in the same paragraph, so no reader can lift the number as a default.
- The companion `personalization_needs` entry does the real work: "the notice period each
  contract actually requires, which is a term of that contract and is shaped by the
  jurisdiction it was written under, so it is established per contract at adoption and never
  carried over as a default from another one."
- lane-08 has the same exposure with tax and filing deadlines, and so does anyone writing a
  compliance cadence: name what sets the period, do not name the period.
