# Build-bench judge bundle — web-research-desk / variant=multiagent

- terminal phase: **failed** (ok=False)
- total build time: **624.72s**
- capture source: build_session+persona · setup_status=ready
- error: Test failures couldn't be auto-corrected: fix_pass: LLM did not emit a valid agent_ir JSON block — keeping previous IR

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

## Resolved capabilities (5)
- **Topic Sweep** — hints=['WebSearch', 'WebFetch'] trigger={'description': 'User supplies a research topic, question, or keyword phrase and requests a current web snapshot, source ranking, or cited summary.', 'type': 'user_message'}
- **Scheduled Feed Scan** — hints=['WebFetch', 'WebSearch', 'CronCreate', 'ScheduleWakeup'] trigger={'allow_manual_invoke': True, 'description': 'Runs daily at 07:00 local time; can also be invoked manually with an optional topic filter.', 'schedule': 'cron(0 7 * * *)', 'type': 'scheduled'}
- **Deep-Dive Synthesis** — hints=['WebFetch', 'WebSearch'] trigger={'description': 'User supplies an explicit list of URLs and requests a structured research briefing; no scheduling or event required.', 'type': 'user_invocation'}
- **Log Finding to Airtable** — hints=['airtable_create_record', 'airtable_list_records'] trigger={'description': 'Fires automatically whenever a sibling capability emits a vetted_finding event. Can also be invoked directly with a finding payload for manual or backfill logging.', 'type': 'event'}
- **Publish Digest to Notion** — hints=['notion_create_page', 'notion_append_block', 'notion_query_database', 'notion_update_page'] trigger={'description': 'Fires when another capability emits a completed digest or briefing artifact — specifically when uc_deep_dive or uc_feed_scan mark their output as finished. Can also be invoked manually with a briefing payload.', 'type': 'event'}

## Connectors + credential links
- required_connectors: ['personas_database', 'personas_vector_db', 'personas_messages', 'airtable', 'notion']
- credentialLinks: {}

## Hard assertions
- [PASS] capabilities_count: expected >= 5 · actual 5
- [PASS] web_research_caps: expected >= 3 · actual 3 (['uc_topic_sweep', 'uc_feed_scan', 'uc_deep_dive'])
- [PASS] connector_present:airtable: expected service_type 'airtable' in required_connectors · actual ['airtable', 'notion', 'personas_database', 'personas_messages', 'personas_vector_db']
- [PASS] connector_present:notion: expected service_type 'notion' in required_connectors · actual ['airtable', 'notion', 'personas_database', 'personas_messages', 'personas_vector_db']
- [WARN] credential_link:airtable: expected credentialLinks['airtable'] resolves · actual MISSING (vault credential?)
- [WARN] credential_link:notion: expected credentialLinks['notion'] resolves · actual MISSING (vault credential?)
- [PASS] no_external_search_connector: expected no serpapi/tavily/google_search/… · actual none
- [WARN] tool_test:airtable: expected pass · actual failed
- [PASS] tool_test:notion: expected pass · actual passed
- [PASS] setup_status: expected ready · actual ready

## Score this (0-3 each) per the rubric
- **coverage** (weight 2.0): Do the resolved capabilities cover all five requested jobs (sweep, scheduled scan, deep-dive, Airtable log, Notion publish) without collapsing distinct jobs into one or padding with invented ones?
- **capability_distinctness** (weight 1.0): Are the 5 capabilities genuinely distinct (different triggers/inputs/outputs), or near-duplicates?
- **connector_binding_correctness** (weight 2.0): Do the Airtable and Notion capabilities reference the CORRECT connector (service_type airtable / notion), name the right tool in tool_hints, and carry a resolved credentialLink? Penalise if a write is described in prose but no connector tool is bound.
- **trigger_sensibility** (weight 1.5): Are triggers sensible per capability — scheduled scan is a schedule; the two writes are event/reaction or chained off a finding; sweep/deep-dive are manual? Penalise a scheduled trigger on the interactive sweep, etc.
- **groundedness** (weight 1.5): Are all tools real (native web tools + http_request + the two connectors)? Penalise any hallucinated tool, invented connector, or a web-search step that wrongly requires a credential.

Write your verdict JSON to `verdicts/{fixture}/{variant}-{run}.json` — see judge-prompt.md.