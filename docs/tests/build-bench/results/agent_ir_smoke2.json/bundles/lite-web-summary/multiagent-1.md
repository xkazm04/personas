# Build-bench judge bundle — lite-web-summary / variant=multiagent

- terminal phase: **promoted** (ok=True)
- total build time: **70.59s**
- capture source: persona · setup_status=ready

## Intent (what the user asked for)

```
Build a Web Summarizer agent with exactly THREE capabilities:

(1) Summarize a URL — given a web page URL, fetch the page with the native WebFetch/http_request tool, extract the main content, and return a concise 1-paragraph summary that ends with the source URL.

(2) Answer from the web — given a question, use the native WebSearch tool to find the most relevant recent sources, then synthesize a short answer that cites each source URL.

(3) Daily topic digest — on a daily schedule, re-run the tracked topic searches, drop anything already seen, and return a short digest of only what is new.

All three capabilities use ONLY the native web tools (WebSearch, WebFetch, http_request). Do NOT add any external connector, credential, SerpAPI/Tavily, or storage — there is no setup required. No human review needed.
```

## Resolved capabilities (3)
- **Summarize a URL** — hints=['WebFetch', 'WebSearch'] trigger=None
- **Answer from the Web** — hints=['WebSearch', 'WebFetch'] trigger=None
- **Daily Topic Digest** — hints=['WebSearch', 'WebFetch', 'CronCreate', 'CronList', 'ScheduleWakeup'] trigger=None

## Connectors + credential links
- required_connectors: []
- credentialLinks: {}

## Hard assertions
- [PASS] capabilities_count: expected >= 3 · actual 3
- [PASS] web_research_caps: expected >= 3 · actual 3 (['uc-36c2f6e6-eb0c-4dd3-9741-b2ec679f786d', 'uc-4983bf48-62a6-4442-a7d5-ace3da0d5876', 'uc-3bfc8e36-079a-4b21-b4fb-8e9035ef9ed1'])
- [PASS] no_external_search_connector: expected no serpapi/tavily/google_search/… · actual none
- [PASS] setup_status: expected ready · actual ready

## Score this (0-3 each) per the rubric
- **coverage** (weight 2.0): Do the resolved capabilities cover all three requested jobs (summarize-URL, answer-from-web, daily digest) as distinct capabilities without padding or collapsing?
- **capability_distinctness** (weight 1.0): Are the 3 capabilities genuinely distinct (different inputs/triggers/outputs)?
- **trigger_sensibility** (weight 1.5): Is the daily digest a schedule trigger while summarize-URL / answer-from-web are manual? Penalise a schedule on the interactive ones.
- **groundedness** (weight 1.5): Are only native web tools used (WebSearch/WebFetch/http_request)? Penalise any hallucinated tool, invented connector, or a step that wrongly requires a credential.

Write your verdict JSON to `verdicts/{fixture}/{variant}-{run}.json` — see judge-prompt.md.