---
layer: technique
subject: data-viz
technique: chart-loading-economics
status: forged
laws: [creation-names-reaper]
shared_with: []
---

# Chart loading economics

A chart on a product surface has two asynchronous arrivals, not one: the
**data** and the **rendering engine**. Chart engines are routinely among the
heaviest dependencies a front-end carries — geometry, scales, interaction,
animation — and charts are almost never on the critical path of first paint.
Treating the engine as a free import makes every user pay its cost on every
page, including the majority who never scroll to a chart. The economics are a
design problem with a standard solution shape.

## The engine loads lazily, once

- The chart engine ships in its **own deferred chunk**, loaded on first
  approach to a surface that draws. Nothing above the fold of a non-chart
  route should pull it in — one careless import at a shared module hoists the
  whole engine into the entry bundle, and the regression is invisible until
  someone audits bundle composition.
- **Loaded once, shared by all charts.** The first chart pays the download;
  every subsequent chart on the page reuses the module. A per-chart dynamic
  load that resolves to the same module is fine; per-chart *copies* (multiple
  engines, or multiple versions of one) is a bundle-audit finding.
- The load is **started early and awaited late** where possible: kick off the
  engine fetch when the user's trajectory makes a chart likely (route entered,
  section approached), so the engine race with the data is usually won by the
  time data lands.

## Geometry is reserved before anything arrives

The surface knows the chart's dimensions before it knows the engine or the
data — height is a layout decision, not a data property. So:

- The chart's slot renders immediately at **final height**, holding layout
  still through both arrivals. The placeholder inside it matches the eventual
  geometry (a calm block where the plot will be, chrome-consistent header if
  the chart has one) per the placeholder rules of
  [async-ui-states](../../async-ui-states/async-ui-states.md).
- **Code arrival and data arrival share one placeholder.** The user does not
  distinguish "engine downloading" from "query running", and the surface must
  not either — one placeholder covers the union of the waits, delayed so warm
  paths never flash it, replaced exactly once by the drawn chart.
- Height reservation is what makes lazy engines *free* from the user's seat:
  the only observable difference between eager and lazy is when bytes moved,
  never a layout jump.
- **Make the loading affordances required parameters of the primitive, not
  optional ones.** The measured pattern, wherever chart shells exist: a
  required height prop is passed at every single call site; an optional
  placeholder prop defaulting to nothing is omitted at most of them — same
  feature area, same authors, same week. A defaulted-away fallback means the
  engine downloads behind an unexplained blank rectangle at the majority of
  call sites. What the primitive requires, every chart gets; what it makes
  optional, only the diligent minority gets.

## Mount on visibility

A dashboard can hold dozens of charts; drawing all of them on page entry
spends main-thread time on instruments nobody has scrolled to.

- Charts **below the viewport defer mounting** until they approach it,
  observed via viewport-visibility observation with a generous margin (start
  work one screen early, so scrolling never catches an empty slot).
- The observation is one-shot per chart: once mounted, a chart stays mounted
  — scrolling away must not unmount and re-animate it on return (identity and
  entrance rules per
  [arrival-choreography](../../async-ui-states/techniques/arrival-choreography.md)).
- Every observer, subscription, and animation handle a chart creates is
  released when the chart is destroyed —
  [creation names its reaper](../../_laws.md#creation-names-reaper). Chart
  surfaces are long-lived and re-rendered often; a leaked per-render observer
  or resize listener is the classic slow-death dashboard defect.
- When many charts become visible at once (page entry on a dashboard), stagger
  or cap concurrent first-draws rather than contending for one frame budget;
  a brief ripple of arrivals reads better than one long freeze.

## Every chart gets its own failure boundary

A chart render is the most exception-prone code path on a data surface:
untrusted data shapes, degenerate domains (all zeros, one point, NaN),
engine edge cases. The structural rule:

- **A rendering failure in one chart degrades one chart.** Its slot shows a
  failure state (per
  [empty-and-degraded-chart-states](empty-and-degraded-chart-states.md));
  every sibling instrument keeps working. A dashboard where one malformed
  series blanks the whole page has coupled its instruments into a single
  point of failure at exactly the moment the user came to diagnose something.
- The boundary also covers the **engine's absence**: a failed chunk load is a
  failure state on the chart slots, not a broken page. Retry re-attempts the
  load; the rest of the surface never knew.
- Failures inside chart rendering are **reported to telemetry** with the
  chart's identity and the data shape that triggered them. Per-chart
  boundaries make failures invisible to casual QA precisely because they
  contain them — containment without reporting converts a crash into a
  permanently broken instrument nobody mentions.

## What to measure to know it's working

- Entry-bundle audit: the chart engine appears in **zero** entry chunks.
- A cold load of a chart-free route downloads no engine bytes.
- A dashboard scroll: charts are drawn by the time they enter the viewport,
  and none re-animates on scroll-back.
- Killing one chart's data (malformed fixture) leaves every sibling alive and
  produces a telemetry event.
