# Build-bench judge bundle — web-research-desk / variant=sequential

- terminal phase: **analyzing** (ok=False)
- total build time: **900.92s**
- capture source: persona · setup_status=ready

## Intent (what the user asked for)

```
Build me a Web Research Desk agent. It has FIVE capabilities:

(1) Topic sweep — given a research topic or question, use web search and web fetch to gather the most relevant recent sources, extract the key facts from each page, and return a ranked, de-duplicated source list with a one-paragraph synthesis. Always cite each source URL.

(2) Scheduled feed scan — on a daily schedule, re-run the tracked topics, pull new items from RSS/Atom feeds and fresh web searches, drop anything already seen, and summarise only what is new.

(3) Deep-dive synthesis — given a set of URLs, fetch and extract each one, then produce a structured briefing (background, key findings, open questions, sources).

(4) Log findings to Airtable — whenever a vetted finding is produced, append it as a row to an Airtable base that tracks research (fields: title, url, topic, summary, captured_at). Use the Airtable connector.

(5) Publish digest to Notion — when a digest or briefing is ready, write it as a page/database entry in Notion so the team can read it. Use the Notion connector.

Web search and web fetch are native tools — do NOT install SerpAPI/Tavily or any external search connector. No human review needed for reads; the Airtable and Notion writes are the only side-effecting steps.
```

## Resolved capabilities (0)

## Connectors + credential links
- required_connectors: []
- credentialLinks: {}

## Hard assertions
- [FAIL] capabilities_count: expected >= 5 · actual 0
- [FAIL] web_research_caps: expected >= 3 · actual 0 ([])
- [FAIL] connector_present:airtable: expected service_type 'airtable' in required_connectors · actual []
- [FAIL] connector_present:notion: expected service_type 'notion' in required_connectors · actual []
- [WARN] credential_link:airtable: expected credentialLinks['airtable'] resolves · actual MISSING (vault credential?)
- [WARN] credential_link:notion: expected credentialLinks['notion'] resolves · actual MISSING (vault credential?)
- [PASS] no_external_search_connector: expected no serpapi/tavily/google_search/… · actual none
- [WARN] tool_test:airtable: expected pass · actual unknown
- [WARN] tool_test:notion: expected pass · actual unknown
- [PASS] setup_status: expected ready · actual ready

## Score this (0-3 each) per the rubric
- **coverage** (weight 2.0): Do the resolved capabilities cover all five requested jobs (sweep, scheduled scan, deep-dive, Airtable log, Notion publish) without collapsing distinct jobs into one or padding with invented ones?
- **capability_distinctness** (weight 1.0): Are the 5 capabilities genuinely distinct (different triggers/inputs/outputs), or near-duplicates?
- **connector_binding_correctness** (weight 2.0): Do the Airtable and Notion capabilities reference the CORRECT connector (service_type airtable / notion), name the right tool in tool_hints, and carry a resolved credentialLink? Penalise if a write is described in prose but no connector tool is bound.
- **trigger_sensibility** (weight 1.5): Are triggers sensible per capability — scheduled scan is a schedule; the two writes are event/reaction or chained off a finding; sweep/deep-dive are manual? Penalise a scheduled trigger on the interactive sweep, etc.
- **groundedness** (weight 1.5): Are all tools real (native web tools + http_request + the two connectors)? Penalise any hallucinated tool, invented connector, or a web-search step that wrongly requires a credential.

Write your verdict JSON to `verdicts/{fixture}/{variant}-{run}.json` — see judge-prompt.md.