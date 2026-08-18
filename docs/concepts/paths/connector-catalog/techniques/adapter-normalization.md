---
layer: technique
subject: connector-catalog
technique: adapter-normalization
status: forged
laws: [one-authority-per-vocabulary, failure-not-empty-success]
shared_with: []
---

# Adapter normalization

Declarative rows describe services; adapters absorb the ways services
*behave* differently. When providers diverge in shape — one pages with
cursors and another with offsets, one reports usage per-model and another
per-project, one wraps results in envelopes the next provider doesn't have —
no row attribute can bridge the gap. The disciplined answer is a
per-provider translation unit that maps each heterogeneous API onto **one
internal view model**, so every consumer is written once against the model
and gains all providers simultaneously. The technique is in where the model
comes from, how thin the adapters stay, and how gaps are told.

## The view model comes from consumers, not providers

The defining mistake is designing the internal model as a union of provider
responses — every field anyone returns, optional everywhere. That model has
no semantics: consumers must know which provider filled it to interpret it,
which reintroduces per-provider branching in every consumer, which is the
condition adapters exist to remove.

Design in the other direction. Enumerate what the product's surfaces
actually need — "a list of runs with time, cost, token counts, and status",
"a document with title, body, and children" — and make that the model:
minimal, semantically committed (units, timezones, and enumerations all
pinned), with every field's meaning independent of provider. Then each
adapter carries the full burden of meeting it: converting units, flattening
envelopes, mapping vocabularies. Adapters absorb variance so consumers can
be naive; a model designed from providers distributes variance to consumers
so adapters can be naive — the wrong party is being spared.

Normalize at the **edge**, once: timestamps to one representation, money and
usage to declared units, identifiers to the model's namespace. A "mostly
normalized" model in which one provider's rows carry local times or
per-thousand units is worse than none — consumers write unit conversions
behind a model that promised they wouldn't need to.

## Errors and statuses are part of the model

Providers fail in dialects. The model owns a **closed error and status
taxonomy** — the classes consumers can act on: rejected credential, expired
grant, rate limited, not found, provider outage, malformed response — and
each adapter maps its provider's dialect into it
([one-authority-per-vocabulary](../../_laws.md#one-authority-per-vocabulary)).
Two rules keep the mapping honest:

- **Unmappable failures stay failures.** A response the adapter cannot
  classify maps to an explicit "unclassified provider error" carrying the
  sanitized raw evidence — never to an empty result
  ([failure-not-empty-success](../../_laws.md#failure-not-empty-success)).
  An adapter that catches what it doesn't understand and returns an empty
  list teaches the product that the provider is healthy and empty, the
  most expensive lesson in the subject.
- **Classification routes remediation.** A rejected credential should reach
  the vault's health machinery; a rate limit should reach backoff; neither
  can happen if both arrive as a generic error string.

Two subtler honesty rules, both field-earned:

- **A derived figure carries its epistemic status.** When one provider
  reports billed amounts and another only token counts the adapter prices
  locally, the model needs an is-estimate marker on the figure — otherwise
  the dashboard averages invoices with guesses and labels the result money.
- **A parse gap must not silently shrink data.** When the adapter applies a
  client-side filter (a time window, a threshold) over fields it mapped,
  records whose mapped field is missing or unparseable are **kept**, not
  dropped — a mapping gap that silently discards rows converts an adapter
  bug into invisible data loss, which no consumer can distinguish from a
  quiet provider.

## Capability flags over silent gaps

Providers do not offer identical features, and the model must not pretend
otherwise. When a provider cannot supply a field or an operation, the
adapter **declares** the gap — a capability flag the catalog row or the
adapter registration carries — and consumers render "not available from
this provider" rather than a zero, an empty list, or a fabricated default.
A dashboard showing `0` cost for a provider whose adapter cannot obtain
cost has converted a known limitation into a false measurement. The
lowest-common-denominator alternative (shrink the model to what every
provider supports) quietly deletes the product's best features to
accommodate its weakest integration; declared capability gaps let the model
stay ambitious while staying honest.

## Adapters stay thin, and registration is data

Translation only. Retry policy, caching, credential application, rate
limiting, aggregation — all of it belongs to shared machinery around the
adapters; an adapter that implements its own retries diverges from fleet
behavior precisely where uniformity was the point. Credential application
in particular: the adapter names the credential and the path, and the
vault's [brokered door](../../credential-vault/techniques/brokered-egress.md)
resolves the base address and applies the auth — the adapter never holds
the secret, which keeps N provider modules from becoming N involuntary
vaults. Pagination dialects (cursor, offset, page number) collapse behind
one shared paging helper that adapters feed a page-fetch function; the
helper owns the page cap and the stop conditions, sized so a page fits the
transport's own body limits — bounds decided once, not re-guessed per
provider. A useful review test: an
adapter should read as a pure mapping — request in provider terms out,
response in model terms back — with no state and no policy. Anything else
in the body is a candidate for extraction into the shared layer.

Adapters register under the **catalog identity** in an enumerable registry —
the same keyed-slot shape as [form overrides](schema-driven-forms.md), and
the same audit affordance: which providers have adapters, which model
operations each supports, and (via the registry) which catalog rows promise
capabilities no adapter implements — a cross-check that catches the
declaration/reality drift [catalog-as-data](catalog-as-data.md) warns about.

## Test against recorded reality

Adapters break at provider whim, not at release cadence. Two test layers,
different jobs: **contract tests** run every adapter against the shared
model's invariants over *recorded* provider responses (units converted,
taxonomy mapped, gaps declared — cheap, deterministic, run always); **liveness
probes** hit real providers on a schedule to detect the recordings going
stale. Collapsing the two — testing only against live providers — makes the
suite flaky and slow, so it gets skipped, so the recordings never update, so
the adapter's model compliance decays exactly as fast as it would have with
no tests. Recording provenance (when captured, from which API version) is
what makes "the recording is stale" a checkable claim rather than a
suspicion.
