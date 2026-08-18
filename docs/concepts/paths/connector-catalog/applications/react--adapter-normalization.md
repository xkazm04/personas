---
layer: application
subject: connector-catalog
technique: adapter-normalization
stack: react
---

# Adapter normalization in the LLM-observability overview

`src/features/plugins/dev-tools/sub_llm_overview/llmTracingAdapters.ts` puts
four heterogeneous LLM-tracing providers — Tracklight (self-hosted),
Langfuse, LangSmith, Helicone (`LlmToolServiceType`, `:40`) — behind one
consumer-first view model: `LlmPinpoint` (`:24-37`), which is exactly what
the overview table needs (use-case, provider, model, calls, token counts,
cost) and nothing any single provider happens to return. Providers that
roll up server-side map 1:1; providers that return raw per-call records go
through the shared `foldByUseCase` aggregator (`:431`), so the shape
consumers see is identical either way.

## Standard moves, as shipped

- **Credential custody stays outside the adapters.** Every call goes through
  the credential API proxy (`executeApiRequest`; module doc `:4-8`): the
  proxy resolves the base URL and injects auth server-side, "the frontend
  never sees the secret." The adapters name a credential id and a path —
  the brokered-egress split, applied so that four provider modules did not
  become four involuntary vaults.
- **Pagination dialects collapse into one helper.** `fetchPaged` (`:121-133`)
  takes a page-fetch closure returning `{ items, next }` where `next` is "a
  page number, offset, or opaque token"; the helper owns the stop conditions
  and the caps — `PAGE_SIZE = 200` (`:106`) sized explicitly so responses
  stay under the proxy's 2 MB body cap, `MAX_PAGES = 5` (`:112`) bounding
  latency. Bounds decided once, consumed by all three raw-record adapters.
- **A derived figure carries its epistemic status.** `costIsEstimate`
  (`:36`) rides on every row; Tracklight's token×price book sets it `true`
  with the reason in a comment (`:92-94`), and the aggregator propagates it
  honestly — a folded group is an estimate if *any* member was
  (`:454`, `g.some(...)`).
- **A parse gap must not shrink data.** The client-side window filter
  `olderThan` (`:151-154`) **keeps** records with missing/unparseable
  timestamps — the comment states the rule: "so a mapping gap can't
  silently hide data."
- **Gap-filling is explicit and bounded.** `inferProvider` (`:161`) is a
  labeled best-effort for providers that omit the field, returning
  `'unknown'` rather than fabricating when the model id matches nothing.
- **Numeric coercion is centralized** (`toNum`, `:136-143`) instead of
  re-guessed per mapper.

The sibling `arxivClient`
(`src/features/plugins/research-lab/sub_literature/arxivClient.ts`) shows the
error half of the technique on an unauthenticated API: `ArxivSearchError`
(`:39`) carries a closed `ArxivErrorKind` taxonomy (`:32` — timeout / http /
network / feed / parse) and its doc comment states the law directly: "Distinct
from an empty result set: an empty array means 'no matches', an
ArxivSearchError means the request itself failed."

## Where the repo deviates from the standard

- **Recorded-reality tests are absent.** The module header is honest about
  it — the three SaaS mappers are "derived from each tool's public API docs
  (not yet exercised against a live account)" — but honesty in a comment is
  not a contract test over recorded responses; the first live connection is
  the test suite, per user.
- **The error taxonomy is not shared.** The tracing adapters throw plain
  `Error` with status text (e.g. `:76-79`), so a rejected credential, a
  rate limit, and an outage all reach the UI as one string — none can route
  to the vault's health machinery or to backoff. The arxiv client's typed
  kinds are the in-repo model the tracing adapters should adopt.
- **Registration is a union type, not a registry.** Dispatch on
  `LlmToolServiceType` is a switch across four literals; adding a fifth
  tool edits the module rather than registering an adapter under the
  catalog identity. Fine at four; the technique's registry shape is the
  growth path.
