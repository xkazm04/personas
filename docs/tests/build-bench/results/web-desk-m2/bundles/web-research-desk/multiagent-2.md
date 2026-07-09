# Build-bench judge bundle — web-research-desk / variant=multiagent

- terminal phase: **failed** (ok=False)
- total build time: **367.89s**
- capture source: build_session+persona · setup_status=ready
- error: Test failures couldn't be auto-corrected: fix_pass: corrected agent_ir failed to parse as AgentIr: data did not match any variant of untagged enum AgentIrUseCase at line 1 column 16137

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
- **Topic Sweep** — hints=['web_search', 'web_fetch'] trigger={'description': 'Triggered when a user provides a research topic, question, or keyword phrase and requests an intelligence briefing.', 'example_phrases': ['sweep on', 'research', 'what do we know about', 'brief me on', 'topic sweep', 'find sources on', 'intelligence on'], 'type': 'manual'}
- **Scheduled Feed Scan** — hints=['web_search', 'web_fetch', 'rss_atom_parse', 'vector_upsert', 'vector_similarity_search', 'db_read', 'db_write', 'email_send'] trigger={'description': 'Runs every morning at 07:00 local time; can be overridden per-user at registration.', 'schedule': '0 7 * * *', 'timezone': 'America/New_York', 'type': 'cron'}
- **Deep-Dive Synthesis** — hints=['notion', 'airtable', 'web_fetch', 'web_search'] trigger={'description': 'Triggered when a user provides one or more URLs and asks for a structured synthesis, summary, or briefing.', 'patterns': ['synthesize these URLs', 'deep dive on these links', 'briefing from these sources', 'summarize these pages', 'fetch and summarize', 'turn these URLs into a briefing', 'research these links'], 'type': 'user_message'}
- **Log Finding to Airtable** — hints=['airtable.create_record', 'airtable.list_bases', 'airtable.list_tables'] trigger={'description': 'Triggered whenever a vetted finding is produced by any sweep or synthesis capability within the persona. Listens for internal `finding.vetted` events and immediately appends the finding to Airtable.', 'type': 'event'}
- **Publish Digest to Notion** — hints=['notion.pages.create', 'notion.blocks.children.append', 'notion.databases.query', 'notion.databases.retrieve', 'notion.pages.retrieve', 'notion.search'] trigger={'conditions': ['briefing contains at least one vetted finding', 'briefing has not already been published to this Notion target'], 'description': 'Fires when a digest or deep-dive briefing has been fully assembled and vetted — either triggered by another capability signaling completion (e.g., after de-duplication and synthesis) or invoked directly by the user requesting publication.', 'event_sources': ['internal_capability_completion', 'user_explicit_request'], 'type': 'event'}

## Connectors + credential links
- required_connectors: ['personas_vector_db', 'personas_database', 'airtable', 'notion', 'gmail', 'personas_messages']
- credentialLinks: {}

## Hard assertions
- [PASS] capabilities_count: expected >= 5 · actual 5
- [FAIL] web_research_caps: expected >= 3 · actual 2 (['uc_topic_sweep', 'uc_scheduled_feed_scan'])
- [PASS] connector_present:airtable: expected service_type 'airtable' in required_connectors · actual ['airtable', 'gmail', 'notion', 'personas_database', 'personas_messages', 'personas_vector_db']
- [PASS] connector_present:notion: expected service_type 'notion' in required_connectors · actual ['airtable', 'gmail', 'notion', 'personas_database', 'personas_messages', 'personas_vector_db']
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