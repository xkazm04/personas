---
id: twin-knowledge-from-codebase
title: Teach my Twin what my product IS (from the codebase + a knowledge .md), then have it speak about it per channel
promotion: discovery
primary_contexts: [twin-knowledge, vector-kb, twin-tone, twin-channels, obsidian-brain]
surfaces: [plugins/twin, keys, vault]
relevant_characters: [software-developer, solo-founder, content-marketer, freelance-agency, hobbyist-power, support-lead, researcher, it-sysadmin, sales-rep, smallbiz-owner, prospect-buyer, non-english-user]
---

## Goal (user POV)
"My Twin should actually know my product. Point it at my SaaS codebase and at the one `.md` doc where I keep the real positioning/FAQ, so it stops writing generic slop. Then, when someone asks about my product in a channel, it should draft a reply that's true to the product and right for that channel."

## Grounding note (surfaces that exist today)
- **Directory/repo ingest is real**: `kb_ingest_directory` (`src-tauri/src/commands/credentials/vector_kb.rs:538-593`) recursively walks a folder and ingests `.md .txt .rs .py .js .ts .tsx .jsx …`. **But it lives in the Vault/KB feature (`src/features/vault/shared/vector/**`), NOT in Twin's own tabs** — `BrainAtelier.tsx` never references it.
- **Twin → Knowledge → "Ingest docs"** (`twin_ingest_doctrine_docs`, `twin.rs:2497-2554`, `data-testid="twin-ingest-docs-button"`) ingests **Personas' own bundled product docs**, not the user's codebase. Trap: it looks like the codebase-ingest button.
- **`twin_draft_reply`** (`twin.rs:1008-1039+`) is real and genuinely KB-grounded (tone for channel + distilled facts + recent comms + retrieved KB passages with provenance).
- **`twin_recall`** is preview-only (`RecallPreviewPanel.tsx:61`) — it does **not** feed a persona's runtime prompt.
- Twin is **shipped, no tier gate** (`PluginsSidebarNav.tsx:95`).

## Definition of done
- My Twin's knowledge base actually contains my product's truth (from the repo and/or my `.md`), and I can verify it does.
- A drafted reply demonstrably uses that knowledge — it names real things from my product and doesn't invent features.
- The draft is right for the channel it's going to (a Slack reply ≠ an email ≠ an SMS).
- I trust it enough to approve and send.

## What L1 must check
- **The discovery gap.** From inside Twin, is there any affordance that leads the Character to the folder-ingest capability? Trace Twin → Brain → KB binding and list what ingest affordances Twin itself exposes. If a Character must leave Twin, find the Vault feature, and ingest against the same `knowledge_base_id` by hand — is that discoverable, and would this Character find it?
- **The doctrine-docs trap.** Would this Character click "Ingest docs" believing it ingests their codebase? What does the label/i18n string actually say? Severity of the mislead.
- **Is a codebase even the right corpus?** Audit what `kb_ingest_directory` does with source files (chunking/embedding of `.rs`/`.ts`) and judge whether retrieved code chunks would actually improve a *marketing/support reply*, or pollute it. This is a quality question, not just a plumbing one.
- **The `.md` knowledge-doc path** — is there a clean "one doc is my source of truth" flow? (`kb_ingest_files`, `IngestDropZone.tsx:58`, `kb_ingest_text`/`IngestTextModal.tsx:30`, Obsidian subpath.)
- **Grounding audit on `twin_draft_reply`**: exactly what enters the prompt (`twin_kb_block`, `twin.rs:941-968`), what the retrieval budget is, and whether the corpus map rides along.
- **Per-channel differentiation**: is `twin_tones` genuinely per-channel, and does the draft path resolve the right tone with a `generic` fallback?
- **The runtime cliff**: a *persona* cannot call `get_tone`/`recall_memory` at runtime (catalog labels only, zero execution handlers). Does that break this Character's mental model of "my agents speak as my twin"?

## What L2 must confirm (l2_priority)
- **Ingest a real folder of `.md` + source and assert retrieval actually fires**: drive a real `twin_draft_reply` and assert the live draft names a real entity that exists ONLY in the ingested corpus. This is the core grounded-path assertion.
- Whether ingesting source code degrades or improves reply quality vs. `.md`-only (run both, compare) — senior-quality bar.
- Real ingest time + embedding cost for a realistic repo, vs. the Character's patience.
- Per-channel drafts side by side: are they actually different, or the same text with a different length?
- Provenance/citation rendering in the live outbox — does the Character believe it?
