# Twin Card 1.0

**Status:** 1.0, first published 2026-10-01 with Personas (spark `twin-portable-blueprint`).
**Files in this folder:** `SPEC.md` (this document), `RENDERER.md` (how a card becomes a system prompt), `twin-card.schema.json` (JSON Schema 2020-12, normative for structure), `examples/` (cards that validate).

A Twin Card is one portable file that captures **how one person writes**: their identity, their voice on each channel (measured style, written rules, real examples), optionally what they know about themselves and the record of how they were trained, and the evidence a consumer needs to judge whether the twin is good enough. Any tool that drafts correspondence (email, chat, social replies) can load a Twin Card and write in that person's voice with the same quality the producing tool achieved.

The key words MUST, MUST NOT, SHOULD, SHOULD NOT and MAY are used as in RFC 2119.

## 1. Scope

**In scope:** one person's own writing style and self-knowledge. **Out of scope, always:** other people's data. A card MUST NOT contain contact handles, messages other people sent, threads, or notes about third parties. Stylometry identifies authors, and the people a twin corresponds with never consented to travel in a file.

A Twin Card is not a role-play character card and not an agent capability card. It describes a real person's voice; it grants no permissions and names no tools.

**Roles.** A *producer* writes cards. A *consumer* reads them. A *renderer* turns a card into the prompt text a language model receives (RENDERER.md). One program can be all three.

## 2. The file

- One UTF-8 JSON object. File name `<slug>.twin.json`. Media type `application/vnd.twin-card+json`.
- The object MAY be embedded in a Character Card V3 under `data.extensions["twin-card"]` (section 11).
- The file self-locates its schema: `"$schema": "https://personas.app/schemas/twin-card/1.0/twin-card.schema.json"`. A vendored copy sits beside this spec; consumers validate against the copy that matches `spec_version`, not against the network.

## 3. Envelope

| Field | Required | Meaning |
|---|---|---|
| `$schema` | yes | the schema address above |
| `spec` | yes | the literal `"twin-card"` |
| `spec_version` | yes | `"MAJOR.MINOR"`; this document is `"1.0"` |
| `card_id` | yes | a UUID the producer keeps stable across re-exports of the same twin. Consumers MUST NOT use it as a key in their own store (it is the producer's identifier, not a global one) |
| `created_at` | yes | when the twin was created, RFC 3339 UTC |
| `exported_at` | yes | when this file was written, RFC 3339 UTC |
| `generator` | yes | `{ "name", "version" }` of the producing program |
| `identity` | yes | section 4 |
| `voice` | yes | section 5 |
| `knowledge` | no | section 6, MAY be sealed |
| `training` | no | section 7, MAY be sealed |
| `evidence` | no | section 8 |
| `integrity` | yes | section 9 |
| `signature` | no | section 10 |
| `extensions` | no | `{ "<reverse-dns key>": any }`. Producers put tool-specific data here and nowhere else |

The five content sections are the **parts**. `identity` and `voice` are always present and never sealed; `knowledge`, `training` and `evidence` are optional.

## 4. `identity`

| Field | Required | Meaning |
|---|---|---|
| `name` | yes | the person's name as they want it written |
| `role` | no | their role, one line |
| `bio` | no | a short third-person description |
| `languages` | yes (may be empty) | BCP 47 tags the person writes in, most used first (`["cs", "en"]`) |
| `grammatical_gender` | no | `"masculine"` \| `"feminine"` \| `"neutral"`: which grammatical forms the person uses about themselves, for languages that inflect by it. Not a statement about gender identity beyond that |

## 5. `voice`

The core of the card: everything a renderer needs to write like the person.

| Field | Required | Meaning |
|---|---|---|
| `scale` | yes | the literal `"twin-card.style/1"` (section 5.1) |
| `default_channel` | yes | the channel to fall back to when a requested one is absent; normally `"generic"` |
| `standing_directions` | no | the person's own standing instructions for every draft (e.g. "never promise a date I do not control") |
| `quality_rules` | yes | section 5.2 |
| `channels` | yes (at least one) | section 5.3 |

### 5.1 The style scale `twin-card.style/1`

Eight dimensions, each an integer **1 to 5**. The level descriptors are normative: a producer that measures style MUST map onto them, a renderer that describes style MUST use them.

| Dimension | 1 | 2 | 3 | 4 | 5 |
|---|---|---|---|---|---|
| `formality` | intimate | casual | consultative | formal | ceremonial |
| `warmth` | detached | neutral | cordial | warm | affectionate |
| `humor` | none | dry | light | playful | irreverent |
| `energy` | matter-of-fact | calm | engaged | upbeat | exuberant |
| `length` | one-liner | brief | medium | full | expansive |
| `directness` | blunt | direct | balanced | softened | indirect |
| `expressiveness` | none | rare | occasional | frequent | heavy (emoji, exclamations, slang) |
| `detail` | headline | key points | explained | thorough | exhaustive and structured |

Coherence: a style MUST NOT combine `formality >= 4` with `expressiveness >= 4`, nor `humor = 5` with `formality = 5`.

The scale is a summary, not the voice. Research on style imitation finds that language models reproduce informal registers poorly from adjectives alone, which is why every channel also carries verbatim exemplars (5.3) and renderers MUST include them.

### 5.2 `quality_rules`

The register every draft is written in, as data so it travels with the twin instead of living in one program's code.

| Field | Meaning |
|---|---|
| `profile` | a named profile, e.g. `"personas.plain-voice/1"` |
| `register` | one paragraph naming the register to write in |
| `avoid_phrases` | words and constructions that mark text as machine-written (lowercase) |
| `filler_openers` | openers that carry no content and mark a turn as generated (lowercase, whole-word) |
| `dash_policy` | `"avoid"` (join clauses with commas and full stops) or `"allow"` (the person uses clause dashes themselves) |

### 5.3 `channels[]`

One entry per channel the person writes on. `channel` is a lowercase id; the recommended vocabulary is `generic, email, slack, teams, discord, telegram, whatsapp, sms, voice, linkedin, browser`, and any other lowercase word is allowed.

| Field | Required | Meaning |
|---|---|---|
| `channel` | yes | the channel id; unique within the card |
| `style` | no | `{ "dims": { the eight dimensions }, "origin": { "kind": "preset" \| "rolled" \| "learned" \| "manual", "preset_id"?: string } }`. **Declared** data: the measured or chosen style. `null`/absent when none was recorded |
| `directives` | yes (may be `""`) | how the person writes on this channel, in prose. **Derived** data (often generated from `style`); when the producer knows the deriver it SHOULD say so in `provenance` |
| `length_hint` | no | a short phrase ("One or two sentences") |
| `constraints` | yes (may be empty) | do/don't rules, one per entry |
| `exemplars` | yes (may be empty) | `[{ "text", "source"?: "sample" \| "training" \| "manual" \| "unknown" }]`: messages the person actually wrote on this channel, verbatim, most recent first |
| `provenance` | no | `{ "derived_by"?: string, "derived_at"?: RFC 3339 }` for the derived fields |

## 6. `knowledge` (optional, sealable)

What the person has confirmed about themselves. Only **approved** items; never a pending guess.

- `memories`: `[{ "title"?, "content", "observed_at" (RFC 3339), "source"? (where it was learned: "training", "sample", "url", ...), "importance" (1-5) }]`
- `facts`: `[{ "content", "importance" (1-5) }]` - facts about the person themselves (scope self). Facts about a contact are third-party data and MUST NOT appear.

## 7. `training` (optional, sealable)

The record of how the twin was taught, so another tool can resume training where it stopped instead of starting over.

- `goals`: `[{ "slot", "title", "intent"?, "criteria": [string], "state": "open" | "covered" | "dropped", "coverage_permille" (0-1000), "answered" (count) }]`. `slot` is `identity`, `tone`, `channels`, `memories` or `training:<topic>`.
- `qa`: `[{ "question", "answer", "kind"?: "scene" | "opinion" | "reply_drill" | "fact" | "rule" | "preference", "slot"?, "incoming"? (for a reply drill, the message answered), "answered_at" (RFC 3339) }]` - the person's answers, verbatim. A reply drill's answer is itself a writing sample.
- `observations`: `[{ "text", "evidence" (count of answers supporting it) }]`.

## 8. `evidence` (optional)

Counts a consumer can use to judge the twin before trusting it. Integers only.

- `exemplars_per_channel`: `{ "<channel>": count }`
- `coverage_permille`: `{ "identity", "voice", "knowledge", "training" }`, each 0-1000 or `null` when unmeasured
- `readiness_percent`: 0-100
- `answers`: count of training answers
- `last_trained_at`: RFC 3339 or `null`
- `renderer`: the renderer contract the producer drafted with, e.g. `"twin-card.render/1"`

## 9. `integrity`

```json
"integrity": {
  "alg": "sha256",
  "canonicalization": "rfc8785",
  "parts": { "identity": "<hex>", "voice": "<hex>", "knowledge": "<hex>", "training": "<hex>", "evidence": "<hex>" }
}
```

- Each present part is hashed: SHA-256 over the UTF-8 bytes of its **plaintext** value serialized with RFC 8785 (JSON Canonicalization Scheme). A sealed part is hashed before sealing, so its hash can be checked only after it is unsealed.
- **Producers MUST NOT put non-integer numbers anywhere in a part.** Coverage is per-mille, readiness is a percent, dims are 1-5. This keeps canonicalization exact without a floating-point formatter.
- A consumer MUST report a hash mismatch as a changed part, and SHOULD refuse to import that part.

## 10. `signature` (optional)

```json
"signature": { "alg": "Ed25519", "key_id": "<producer key id>", "public_key": "<base64url>", "value": "<base64url>" }
```

Signs the RFC 8785 canonical form of the WHOLE card with the `signature` member removed. A consumer reports one of three states: **valid**, **invalid** (present and wrong; the file was altered), or **unsigned** (absent). Unsigned is not invalid. A signature proves which key wrote the file, not who the person is.

## 11. Sealing

A sealed part keeps its name and replaces its value with:

```json
"knowledge": { "sealed": { "alg": "AES-256-GCM", "kdf": "PBKDF2-HMAC-SHA256", "iterations": 600000, "salt": "<base64>", "nonce": "<base64>", "ciphertext": "<base64>" } }
```

- `ciphertext` decrypts to the canonical JSON of the plaintext part. Each sealed part has its own salt and nonce.
- `iterations` is stated in the file; a consumer MUST use the stated value.
- `identity` and `voice` MUST NOT be sealed: they are what any automation needs.

## 12. Versioning and compatibility

- `spec_version` is `MAJOR.MINOR`. A MINOR release only adds optional fields. A consumer of 1.x MUST read every 1.y card, ignoring fields it does not know.
- A card whose MAJOR the consumer does not implement is **unsupported**, a distinct outcome from **invalid** (a card that fails its own schema). Tools MUST report the two differently.
- A consumer that re-exports a card it imported MUST preserve `extensions` it does not understand.

## 13. Character Card V3 mapping

A producer MAY also write a Character Card V3 (`spec: "chara_card_v3"`, `spec_version: "3.0"`) for tools that only read that format:

| CCv3 `data` field | From |
|---|---|
| `name` | `identity.name` |
| `description` | `identity.role` + `identity.bio` |
| `personality` | the `generic` channel's style, described with the 5.1 level words |
| `system_prompt` | the RENDERER.md output for `default_channel` |
| `mes_example` | the `default_channel` exemplars, each as a `<START>` block |
| `extensions["twin-card"]` | the complete Twin Card |

The Twin Card inside `extensions` is authoritative; the flattened fields are a convenience and lose information.

## 14. Privacy notes for producers

- Seal `knowledge` and `training` when the file will leave the person's machine.
- Exemplars are the person's own messages, but they can mention other people. Producers SHOULD let the person review exemplars before export.
- Never infer and export a trait the person did not confirm.
