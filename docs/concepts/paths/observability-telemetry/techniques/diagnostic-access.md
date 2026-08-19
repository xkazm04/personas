---
layer: technique
subject: observability-telemetry
technique: diagnostic-access
status: forged
laws: [gate-sees-target]
shared_with: []
---

# Diagnostic access

Records nobody can reach do not exist. The recording subsystem has
three consumers who are not the developer with a debugger — the
operator on their own machine, the support engineer working through a
user, and the future maintainer holding only an exported artifact — and
each needs a **named, working path to the records**. Access is the part
of this subject most often left unbuilt, because during development the
developer's own tooling papers over its absence; the gap surfaces on
the first support case, which is the most expensive possible moment to
discover that the only way to get the logs is a screen-share and a
filesystem safari.

## Surface the location, don't make them hunt

The records directory lives in a platform-specific application-data
location that varying-skill users cannot reliably navigate to from
instructions. The fix costs one action: a **reveal-the-folder**
affordance in the product's diagnostic or settings surface that opens
the location directly, plus the path printed as selectable text for
the cases where opening fails. This single button converts the
support instruction from a per-platform paragraph with failure modes
into "click the button, send the newest file".

## In-product viewers for the stores that matter

The crash store earns a viewer inside the product: a list of recorded
crashes — when, version, failure summary — with per-record detail and
copy/export. Reasons this is worth the surface area:

- The user asking "why did it die yesterday" should not need to parse
  raw records in an editor to get an answer.
- Support conversations move faster when the user can read a summary
  aloud or paste one record, rather than attach a directory.
- The viewer is the natural home for the retention disclosure ("keeping
  the last N crashes") and for the store's management actions (clear,
  export).

The viewer reads the **actual store** — same directory, same parser as
the shipper, corruption-tolerant reads and all
([gate-sees-target](../../_laws.md#gate-sees-target): a viewer over a
cached copy or a parallel summary answers a different question than
"what is on this disk"). The ordinary log files, by contrast, usually
do not need an in-product reader — the reveal-folder path plus any text
editor serves them — but the *footprint* accounting (current size, file
count, oldest entry, from rotation-and-retention) belongs on the
diagnostic surface where the operator can see it.

## The export bundle: one artifact, second gate

The highest-leverage access feature is the **diagnostic bundle**: one
action produces one shareable artifact containing the recent logs, the
crash records, version and platform facts, and the product's own
configuration *shape* (which features enabled, which integrations
configured — never the credentials inside them). Design rules:

- **Manifest first.** The bundle opens with a human-readable summary
  of what is inside and what was deliberately excluded — the reader
  orients in seconds, and the exclusion list doubles as the privacy
  statement.
- **The export re-applies the privacy gate.** The write path already
  scrubbed, but export crosses a further trust boundary — the bundle
  travels to ticketing systems, mail threads, and third parties the
  original files never would. Scrub again on the way out (it is cheap,
  and the second gate catches what the first gate's era did not know
  was secret), and cap the bundle's size by truncating the oldest
  material, stating the truncation in the manifest.
- **User-inspectable by construction.** The bundle is an ordinary
  archive of ordinary text files, so the user who wants to read what
  they are about to send *can*. Opaque diagnostic blobs spend trust
  that transparent ones earn.

## Access is versioned surface area

Once support instructions, documentation, or muscle memory reference a
path, a button, or a bundle layout, changes to them break the humans
downstream — the one consumer class that cannot be refactored. Renaming
the records directory orphans every old instruction; restructuring the
bundle breaks the support tooling that learned to open it. Treat the
access surface with public-API discipline: additive by default,
migrations that leave a pointer behind (a note at the old location, a
tolerant reader for old layouts), and the bundle's manifest carrying a
format version so tooling can tell which layout it holds.
