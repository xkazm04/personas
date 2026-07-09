# Build-bench judge bundle — lite-web-summary / variant=multiagent

- terminal phase: **failed** (ok=False)
- total build time: **48.05s**
- capture source: persona · setup_status=ready
- error: Validation error: OneShot agent_ir parse error: data did not match any variant of untagged enum AgentIrUseCase at line 1 column 9192

## Intent (what the user asked for)

```
Build a Web Summarizer agent with exactly THREE capabilities:

(1) Summarize a URL — given a web page URL, fetch the page with the native WebFetch/http_request tool, extract the main content, and return a concise 1-paragraph summary that ends with the source URL.

(2) Answer from the web — given a question, use the native WebSearch tool to find the most relevant recent sources, then synthesize a short answer that cites each source URL.

(3) Daily topic digest — on a daily schedule, re-run the tracked topic searches, drop anything already seen, and return a short digest of only what is new.

All three capabilities use ONLY the native web tools (WebSearch, WebFetch, http_request). Do NOT add any external connector, credential, SerpAPI/Tavily, or storage — there is no setup required. No human review needed.
```

## Resolved capabilities (0)

## Connectors + credential links
- required_connectors: []
- credentialLinks: {}

## Hard assertions
- [FAIL] capabilities_count: expected >= 3 · actual 0
- [FAIL] web_research_caps: expected >= 3 · actual 0 ([])
- [PASS] no_external_search_connector: expected no serpapi/tavily/google_search/… · actual none
- [PASS] setup_status: expected ready · actual ready

## Score this (0-3 each) per the rubric
- **coverage** (weight 2.0): Do the resolved capabilities cover all three requested jobs (summarize-URL, answer-from-web, daily digest) as distinct capabilities without padding or collapsing?
- **capability_distinctness** (weight 1.0): Are the 3 capabilities genuinely distinct (different inputs/triggers/outputs)?
- **trigger_sensibility** (weight 1.5): Is the daily digest a schedule trigger while summarize-URL / answer-from-web are manual? Penalise a schedule on the interactive ones.
- **groundedness** (weight 1.5): Are only native web tools used (WebSearch/WebFetch/http_request)? Penalise any hallucinated tool, invented connector, or a step that wrongly requires a credential.

Write your verdict JSON to `verdicts/{fixture}/{variant}-{run}.json` — see judge-prompt.md.