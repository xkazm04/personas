---
layer: application
subject: import-normalization
technique: format-detection
stack: node
---

# The workflow detector — fingerprints, confidence grades, and a confessing guess

`src/lib/personas/parsers/workflowDetector.ts` +
`src/lib/personas/parsers/workflowParser.ts` implement detection for four
foreign automation formats (three JSON node-graph/step-list exports and one
YAML CI-workflow format) feeding the import wizard. The detector is pure
and read-only; the parser owns bounded deserialization and the
unknown-outcome escalation.

## Confirmed against the technique

- **Structural fingerprints, ordered by specificity**
  (`workflowDetector.ts:28-92`): the node-graph format is recognized by a
  `nodes` array whose elements carry the vendor's own type prefix
  (high confidence), falling to `nodes` + `connections` co-occurrence
  (medium — the conjunction rule in action); the step-list format by
  `steps[]` elements carrying `app`/`action`/`action_id`; the
  scenario format by `flow[]`/`blueprint.flow`/`modules[]` variants. The
  most vendor-specific markers sit first; envelope-only shapes score
  lower confidence rather than winning outright.
- **Confidence is part of the outcome**: `DetectionResult` carries
  `confidence: 'high' | 'medium' | 'low'` (`workflowDetector.ts:8-15`),
  and the wizard receives `needsConfirmation` + `detectedConfidence`
  through the `FILE_PARSED` action (`useWorkflowImport.ts:53-61`) — the
  format guess is user-confirmable state, not an internal detail.
- **Bounded parsing before detection**: the YAML loader runs with
  `maxDepth: 50, maxMergeSeqLength: 20` (`workflowParser.ts:32-40`), with
  a comment deriving the bound ("workflow files arrive from external
  tools… only semi-trusted") — the depth-cap-before-deserialization rule
  with its rationale written beside the number. The byte cap is enforced
  upstream at file intake (`useWorkflowImport.ts:82-86`) against the
  service-owned limit constant.
- **The speculative-parse escalation, with the honest bit set**
  (`workflowParser.ts:120-133, 156-192`): on `unknown`, `tryParsers` runs
  all three JSON adapters, scores candidates by extracted structure
  (tools + triggers + connectors), and picks the best — with
  `needsConfirmation = true` unconditionally, confidence `medium` when
  exactly one adapter succeeded and `low` when several did (ambiguity
  stays ambiguous). Zero successes throws a refusal that names the four
  supported formats *and* each adapter's own error — the described
  unknown, not an empty result.
- **Unreadable ≠ unrecognized**: syntax errors are caught and rethrown as
  `Invalid JSON: …` / `Invalid YAML: …` with `cause` preserved
  (`workflowParser.ts:78-96`), a different message class from the
  unsupported-format refusal.

## Where it diverges from the technique — honestly

- **Extension is trusted for the syntax split** (`workflowParser.ts:71`):
  `.yml`/`.yaml` routes to the YAML loader, everything else to JSON, and
  `isSupportedFile` gates on extension alone. A YAML export renamed to
  `.json` is refused as invalid JSON rather than detected. Acceptable for
  a file-picker flow with a declared accept list; it would not survive a
  paste-content entry point without a content-sniff fallback.
- **No version detection.** Fingerprints identify the format family only;
  none of the four adapters branches on an export-schema version. The
  vendor revision that renames a key will surface as degraded extraction,
  not as "newer than we support".
- **Fingerprints are code, not data**: the discriminators live in an `if`
  cascade rather than beside the platform capability tables
  (`platformDefinitions.ts`), so adding a fifth format touches the
  detector, the parser's `switch`, *and* the table file. Three sites for
  one vocabulary extension — the "detection is data too" section of the
  technique names exactly this.
- **No detection telemetry**: unknown-rate is not counted anywhere, so a
  vendor shipping a new export shape becomes support tickets, not a
  rising counter.
