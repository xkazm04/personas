# Notes - lane-01

Software engineering: observability, code review, release (11 recipes)

Append below. Newest last. See ../FIELD_GUIDE.md section 6 for the format.

## 10:05 - RESEARCH - four observability anchors that cover any "watch a number" recipe
- **Symptom over cause** (Rob Ewaschuk, "My Philosophy on Alerting", carried into the SRE
  book): page only on what is user-visible or imminently so; a resource metric is a cause
  and belongs in a report, not on a pager. This is the principle any recipe needs for the
  line between "worth a glance" and "worth waking someone", and most drafts assert that
  line without one.
- **Multiwindow burn-rate** (SRE workbook, alerting-on-SLOs): a fast window and a slow
  window together, so a spike that already ended does not alert. Generalizes far past SLOs
  into "nothing is a breach until it has persisted across a confirming window".
- **USE** (Brendan Gregg): utilization, saturation, errors per resource. Saturation is the
  leading indicator and utilization is the weakest signal, and his own example is the
  quotable one: 100% CPU for seconds at a time reads as 80% in a five minute average.
- **Four golden signals** (SRE book ch.6): latency, traffic, errors, saturation.
  Latency rise is itself a leading indicator of saturation.

## 10:07 - RESEARCH - three quantities worth putting where they decide something
- Change failure rate: elite ~5%, low performers ~64% (DORA). Change-related causes sit
  behind roughly 70-80% of production outages, which is why "a deploy did it" is almost
  always available as an explanation and why a correlation recipe needs a base rate.
- A percentile computed over one window cannot be recombined into a longer one. Any recipe
  baselining a p95 or p99 has to compare like window against like, and saying so is a real
  correction to several drafts.
- "A health check that reports everything is a data dump, not a health check" is the
  practitioner consensus; the useful shape is a ranked short list where each finding
  carries what is wrong, why it matters, and what closes it.

## 10:09 - PATTERN - replace a fixed threshold with the base rate that makes it mean something
- Several of my drafts encoded a constant as the whole judgment (a sigma multiplier, a
  two hour correlation window). Research says practitioners fail on exactly that. The
  rewrite that worked was not "pick a better constant" but "name the quantity that decides
  whether the constant carries information at all": for deploy correlation, how many
  deploys normally land in a window of this length, because a team shipping twenty times a
  day always has one nearby. The knob stays; its `description` now tells the adopter what
  to set it against.

## 10:11 - DECISION - when two recipes in a lane overlap, split them on the SHAPE of the threshold
- `database-health-check` and `database-performance-baseline-monitoring` both said
  "compare against a rolling baseline rather than a fixed number", which made them the same
  recipe. I split them on what the number is: continuous monitoring judges deviation from
  learned normal, while a health check judges **headroom to a limit the engine will
  actually enforce** and its rate of approach. That also fixes a real error, because
  wraparound age or disk free genuinely does deserve a fixed threshold. Worth copying
  wherever a lane has a "monitor X" and an "audit X" pair.


## 11:05 - RESEARCH - four WebFetch URLs that still work after the search budget is gone
- `https://sre.google/sre-book/monitoring-distributed-systems/` gives the four golden signals
  verbatim, plus "latency increases are often a leading indicator of saturation" and the
  argument against designing on averages.
- `https://www.brendangregg.com/usemethod.html` gives the USE definitions and the quotable
  example: 100% CPU for seconds at a time reads as 80% in a five minute average.
- `https://smartbear.com/learn/code-review/best-practices-for-peer-code-review/` gives the
  Cisco study numbers: review 200 to 400 lines at a time, detection degrades above 500 lines
  per hour and after 60 minutes, 70 to 90 percent defect discovery inside those bounds.
- `https://semver.org/` gives the one line most version recipes are missing: software using
  semantic versioning MUST declare a public API, and marking anything deprecated is a MINOR
  bump. Also useful anywhere: a fetch that fails should become a claim written without the
  number, not a number written without the fetch.

## 11:08 - TRAP - a draft that says "treat a missing source as a zero" is stating the bug
- `database-activity-digest` instructed "treat a missing or empty log as a zero, not a reason
  to skip". Half right and half the exact failure App Master 3b names. Empty and missing are
  different results: an empty source is a real zero worth reporting, a source that could not be
  read is not a zero at all. Worth grepping your own drafts for "treat X as zero", "default to
  0", "assume none" - the transformation produced this phrasing in several places and it reads
  as robustness while it destroys the only signal that the pipeline broke.

## 11:12 - PATTERN - a bleed-through outcome is easy to spot and belongs to somebody else
- Two of my drafts carried an outcome whose `success_criteria` were about filing findings into
  a backlog ("a finding already filed and still open is not filed again") on recipes that file
  nothing. Same block, word for word, in a baseline-refresh recipe and a digest recipe: it came
  from a shared source template rather than from either recipe. If an outcome's criteria do not
  mention anything the four description fields mention, it is bleed-through. Replace it with the
  outcome that recipe actually owes rather than deleting it and leaving one outcome behind.

## 11:15 - DECISION - an examples file about the connector being the WRONG resolution
- `infrastructure-metrics-scan` declares `monitoring`, and a product analytics connector
  resolves to that type and produces a plausible infrastructure report made of signups. Nothing
  errors. I wrote that up as a real `examples/` file rather than dropping the entry, because the
  mapping knowledge is genuine and the failure is silent by construction. Worth copying wherever
  a connector type is broad enough that a wrong-but-valid resolution is likely: the file's job is
  to be read at adoption, and "this binds and is still wrong, here is how to tell" is exactly the
  thing nobody writes down.
